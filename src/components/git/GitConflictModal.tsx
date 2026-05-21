import { Show } from 'solid-js'
import { ConflictResolverModal } from './ConflictResolverModal'

interface GitConflictModalProps {
  path: string | null
  onClose: () => void
  onSaved: () => void
}

export function GitConflictModal(props: GitConflictModalProps) {
  return (
    <Show when={props.path}>
      {(path) => (
        <ConflictResolverModal path={path()} onClose={props.onClose} onSaved={props.onSaved} />
      )}
    </Show>
  )
}
