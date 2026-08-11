import { Link } from 'react-router-dom'
import { Button, Card, EmptyState } from '@/components/ui'

export function NotFoundPage() {
  return (
    <Card padded={false}>
      <EmptyState
        title="Page not found"
        description="That screen does not exist in SwiftSearch."
        action={
          <Link to="/">
            <Button variant="primary">Back to Home</Button>
          </Link>
        }
      />
    </Card>
  )
}
