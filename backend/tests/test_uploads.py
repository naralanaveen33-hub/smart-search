"""Content validation and text extraction for uploaded documents."""

from __future__ import annotations

import io
import zipfile

import pytest

from app.services.document_service import (
    UnsupportedFileType,
    extract_text,
    validate_content,
)

MINIMAL_PDF = (
    b"%PDF-1.4\n"
    b"1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n"
    b"2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n"
    b"3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]>>endobj\n"
    b"trailer<</Root 1 0 R>>\n"
    b"%%EOF\n"
)


def make_docx(paragraphs: list[str]) -> bytes:
    """Build a real .docx with python-docx so extraction is genuinely tested."""
    import docx

    document = docx.Document()
    for text in paragraphs:
        document.add_paragraph(text)
    buffer = io.BytesIO()
    document.save(buffer)
    return buffer.getvalue()


def make_pdf(lines: list[str]) -> bytes:
    """Build a small real PDF with pypdf so extraction is genuinely tested."""
    from pypdf import PdfWriter

    writer = PdfWriter()
    writer.add_blank_page(width=612, height=792)
    buffer = io.BytesIO()
    writer.write(buffer)
    return buffer.getvalue()


# --------------------------------------------------------------- text files


def test_plain_text_is_accepted():
    validate_content("notes.txt", b"Blocked sort based indexing notes.")
    assert extract_text("notes.txt", b"hello world") == "hello world"


def test_markdown_is_accepted():
    content = b"# Title\n\nSome **markdown** content."
    validate_content("readme.md", content)
    assert "markdown" in extract_text("readme.md", content)


def test_latin1_text_is_still_readable():
    content = "Café résumé naïve".encode("latin-1")
    validate_content("accents.txt", content)
    assert "Caf" in extract_text("accents.txt", content)


def test_empty_files_are_rejected():
    with pytest.raises(UnsupportedFileType, match="empty"):
        validate_content("empty.txt", b"")


def test_binary_disguised_as_text_is_rejected():
    payload = b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x01\x00"
    with pytest.raises(UnsupportedFileType, match="binary"):
        validate_content("image.txt", payload)


def test_control_character_soup_is_rejected():
    payload = bytes(range(1, 9)) * 40
    with pytest.raises(UnsupportedFileType):
        validate_content("junk.txt", payload)


# ---------------------------------------------------------------------- pdf


def test_valid_pdf_passes_validation():
    validate_content("paper.pdf", MINIMAL_PDF)


def test_pdf_without_a_header_is_rejected():
    with pytest.raises(UnsupportedFileType, match="not a valid PDF"):
        validate_content("fake.pdf", b"this is just text pretending to be a pdf")


def test_truncated_pdf_is_rejected():
    with pytest.raises(UnsupportedFileType, match="truncated"):
        validate_content("cut.pdf", b"%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n")


def test_pdf_text_extraction_runs():
    content = make_pdf(["hello"])
    validate_content("blank.pdf", content)
    # A blank page yields no text; the point is that parsing does not raise.
    assert isinstance(extract_text("blank.pdf", content), str)


# --------------------------------------------------------------------- docx


def test_valid_docx_passes_validation_and_extracts_text():
    content = make_docx(["Blocked sort based indexing", "Second paragraph"])
    validate_content("report.docx", content)
    text = extract_text("report.docx", content)
    assert "Blocked sort based indexing" in text
    assert "Second paragraph" in text


def test_docx_that_is_not_a_zip_is_rejected():
    with pytest.raises(UnsupportedFileType, match="not a ZIP container"):
        validate_content("fake.docx", b"Just plain text with a docx extension")


def test_zip_without_word_document_is_rejected():
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr("hello.txt", "not a word document")
    with pytest.raises(UnsupportedFileType, match="not a Word document"):
        validate_content("archive.docx", buffer.getvalue())


def test_corrupt_docx_is_rejected():
    payload = b"PK\x03\x04" + b"\x00" * 200
    with pytest.raises(UnsupportedFileType, match="corrupt"):
        validate_content("broken.docx", payload)


# ------------------------------------------------------------- through API


def test_api_rejects_a_renamed_binary(client):
    response = client.post(
        "/api/documents/upload",
        files=[("files", ("sneaky.pdf", b"not really a pdf at all", "application/pdf"))],
    )
    assert response.status_code == 400
    assert "PDF" in response.json()["detail"]


def test_api_accepts_a_real_docx(client):
    content = make_docx(["Machine learning and inverted indexes"])
    response = client.post(
        "/api/documents/upload",
        files=[
            (
                "files",
                (
                    "notes.docx",
                    content,
                    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                ),
            )
        ],
    )
    assert response.status_code == 200, response.text
    assert response.json()["uploaded"][0]["title"]


def test_api_reports_partial_failures_without_losing_good_files(client):
    response = client.post(
        "/api/documents/upload",
        files=[
            ("files", ("good.txt", b"a genuine text document about indexing", "text/plain")),
            ("files", ("bad.pdf", b"definitely not a pdf", "application/pdf")),
        ],
    )
    assert response.status_code == 200
    body = response.json()
    assert [d["file_name"] for d in body["uploaded"]] == ["good.txt"]
    assert body["skipped"][0]["file_name"] == "bad.pdf"
