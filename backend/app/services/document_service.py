"""Document ingestion: parsing uploads and seeding the demo corpus."""

from __future__ import annotations

import io
import re
import zipfile
from pathlib import Path

from ..config import Settings
from ..database.store import Store, utc_now

SUPPORTED_EXTENSIONS = {".txt", ".md", ".pdf", ".docx"}

PDF_MAGIC = b"%PDF-"
ZIP_MAGIC = (b"PK\x03\x04", b"PK\x05\x06", b"PK\x07\x08")
# Control characters that never appear in real text (tab/newline/CR excluded).
CONTROL_BYTES = bytes(range(0, 9)) + bytes(range(14, 32))


class UnsupportedFileType(ValueError):
    pass


def validate_content(file_name: str, content: bytes) -> None:
    """Reject files whose bytes do not match their extension.

    Extension checks alone let a renamed binary through, which then fails deep
    inside a parser with an unhelpful error. These checks are cheap and give
    the user a clear reason instead.
    """
    suffix = Path(file_name).suffix.lower()

    if not content:
        raise UnsupportedFileType(f"{file_name} is empty")

    if suffix == ".pdf":
        if not content.startswith(PDF_MAGIC):
            raise UnsupportedFileType(
                f"{file_name} is not a valid PDF (missing %PDF- header)"
            )
        if b"%%EOF" not in content[-2048:] and b"%%EOF" not in content:
            raise UnsupportedFileType(f"{file_name} looks like a truncated PDF")
        return

    if suffix == ".docx":
        if not content.startswith(ZIP_MAGIC):
            raise UnsupportedFileType(
                f"{file_name} is not a valid DOCX (not a ZIP container)"
            )
        try:
            with zipfile.ZipFile(io.BytesIO(content)) as archive:
                names = archive.namelist()
        except zipfile.BadZipFile as exc:
            raise UnsupportedFileType(f"{file_name} is a corrupt DOCX archive") from exc
        if "word/document.xml" not in names:
            raise UnsupportedFileType(
                f"{file_name} is a ZIP file but not a Word document"
            )
        return

    if suffix in (".txt", ".md"):
        sample = content[:8192]
        if b"\x00" in sample:
            raise UnsupportedFileType(f"{file_name} is binary, not text")
        try:
            text = content.decode("utf-8")
        except UnicodeDecodeError:
            try:
                text = content.decode("latin-1")
            except UnicodeDecodeError as exc:
                raise UnsupportedFileType(
                    f"{file_name} is not readable as text"
                ) from exc
        probe = text[:8192]
        control = sum(1 for ch in probe if ord(ch) < 32 and ch not in "\t\n\r")
        if probe and control / len(probe) > 0.05:
            raise UnsupportedFileType(f"{file_name} does not contain readable text")
        return


def extract_text(file_name: str, content: bytes) -> str:
    """Best-effort text extraction for the supported formats."""
    suffix = Path(file_name).suffix.lower()

    if suffix in (".txt", ".md"):
        try:
            return content.decode("utf-8")
        except UnicodeDecodeError:
            return content.decode("latin-1", errors="replace")

    if suffix == ".pdf":
        try:
            from pypdf import PdfReader
        except ImportError as exc:  # pragma: no cover - dependency guard
            raise UnsupportedFileType(
                "PDF support requires pypdf. Install backend requirements."
            ) from exc
        reader = PdfReader(io.BytesIO(content))
        return "\n\n".join((page.extract_text() or "") for page in reader.pages)

    if suffix == ".docx":
        try:
            import docx
        except ImportError as exc:  # pragma: no cover - dependency guard
            raise UnsupportedFileType(
                "DOCX support requires python-docx. Install backend requirements."
            ) from exc
        document = docx.Document(io.BytesIO(content))
        return "\n".join(p.text for p in document.paragraphs)

    raise UnsupportedFileType(f"Unsupported file type: {suffix or file_name}")


def derive_title(file_name: str, text: str) -> str:
    """Use the first meaningful line as the title, else prettify the filename."""
    for line in text.splitlines():
        line = line.strip().lstrip("# ").strip()
        if len(line) >= 3:
            return line[:120]
    stem = Path(file_name).stem
    stem = re.sub(r"^\d+[_-]", "", stem)
    return stem.replace("_", " ").replace("-", " ").title()


class DocumentService:
    def __init__(self, settings: Settings, store: Store) -> None:
        self.settings = settings
        self.store = store

    # ------------------------------------------------------------- helpers

    def _next_doc_id(self) -> str:
        existing = self.store.list_documents()
        numbers = [
            int(m.group(1))
            for d in existing
            if (m := re.match(r"DOC_(\d+)$", str(d.get("id", ""))))
        ]
        return f"DOC_{max(numbers, default=0) + 1:03d}"

    def _text_path(self, doc_id: str) -> Path:
        return self.settings.uploads_dir / f"{doc_id}.txt"

    def read_text(self, doc_id: str) -> str:
        path = self._text_path(doc_id)
        if path.exists():
            return path.read_text(encoding="utf-8")
        for row in self.store.list_documents():
            if row.get("id") == doc_id:
                return row.get("text", "")
        return ""

    # ---------------------------------------------------------------- crud

    def list_documents(self) -> list[dict]:
        docs = self.store.list_documents()
        for doc in docs:
            doc.setdefault("preview", self.read_text(doc["id"])[:180].strip())
        return docs

    def add_document(
        self, file_name: str, content: bytes, *, source: str = "upload"
    ) -> dict:
        validate_content(file_name, content)
        text = extract_text(file_name, content).strip()
        if not text:
            raise UnsupportedFileType(f"No extractable text found in {file_name}")

        doc_id = self._next_doc_id()
        self.settings.uploads_dir.mkdir(parents=True, exist_ok=True)
        self._text_path(doc_id).write_text(text, encoding="utf-8")

        storage_url = self.store.upload_to_storage(
            f"{doc_id}/{file_name}", content, "application/octet-stream"
        )

        row = {
            "id": doc_id,
            "title": derive_title(file_name, text),
            "file_name": file_name,
            "size_bytes": len(content),
            "status": "ready",
            "source": source,
            "uploaded_at": utc_now(),
            "indexed": False,
            "term_count": 0,
            "storage_url": storage_url,
            "preview": text[:180].strip(),
        }
        self.store.add_document(row)
        return row

    def delete_document(self, doc_id: str) -> None:
        path = self._text_path(doc_id)
        if path.exists():
            path.unlink()
        self.store.delete_document(doc_id)

    def mark_indexed(self, doc_lengths: dict[str, int]) -> None:
        docs = self.store.list_documents()
        for doc in docs:
            if doc["id"] in doc_lengths:
                doc["indexed"] = True
                doc["term_count"] = doc_lengths[doc["id"]]
        self.store.replace_documents(docs)

    # ----------------------------------------------------------- demo seed

    def seed_demo_documents(self) -> int:
        """Load the bundled corpus on first run so the app is usable instantly."""
        if self.store.list_documents():
            return 0
        added = 0
        for path in sorted(self.settings.demo_dir.glob("*.txt")):
            try:
                self.add_document(path.name, path.read_bytes(), source="demo")
                added += 1
            except UnsupportedFileType:
                continue
        return added
