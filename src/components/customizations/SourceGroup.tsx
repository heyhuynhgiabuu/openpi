import { For } from 'solid-js'
import { PackageCard } from './PackageCard'
import { type ParsedEntry, type PkgSourceType, SOURCE_LABELS } from './packageHelpers'

interface SourceGroupProps {
  type: PkgSourceType
  entries: ParsedEntry[]
  removingId: string | null
  onRemove: (entry: ParsedEntry) => void
}

export function SourceGroup(props: SourceGroupProps) {
  return (
    <div class="pkg-group-box">
      <div class="pkg-group-header">
        <span class="pkg-group-label">{SOURCE_LABELS[props.type]}</span>
        <span class="pkg-group-count">
          {props.entries.length} {props.entries.length === 1 ? 'package' : 'packages'}
        </span>
      </div>
      <div class="pkg-group-rows">
        <For each={props.entries}>
          {(entry) => (
            <PackageCard
              entry={entry}
              removing={props.removingId === entry.item.id}
              onRemove={props.onRemove}
            />
          )}
        </For>
      </div>
    </div>
  )
}
