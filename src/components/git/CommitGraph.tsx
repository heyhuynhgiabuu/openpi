/**
 * CommitGraph — SVG commit graph lane renderer.
 *
 * Renders colored dots for commits and vertical/diagonal connection lines
 * using the structured graphRows data from `git log --graph --pretty=format`.
 *
 * Column width: 14px per lane. Each lane gets a distinct color.
 * Dots are 8px diameter. Connections are 2px strokes.
 *
 * The SVG is sized to fit a single row vertically but extends its drawing
 * area to the top/bottom edges so adjacent rows visually connect.
 */

import { For } from 'solid-js'
import type { GitGraphColumn } from '../../lib/ipc'

// ─── Lane colors (8-cycle) ────────────────────────────────────────────────

const LANE_COLORS = [
  '#4e9a06', // green
  '#204a87', // blue
  '#a40000', // red
  '#5c3566', // purple
  '#ce5c00', // orange
  '#729fcf', // light blue
  '#8ae234', // light green
  '#e9b96e', // beige
]

function getLaneColor(col: number): string {
  return LANE_COLORS[col % LANE_COLORS.length]
}

// ─── Drawing constants ────────────────────────────────────────────────────

const CW = 14 // column width (px)
const DOT_R = 4 // dot radius (px)
const STROKE_W = 2 // stroke width (px)
const ROW_H = 28 // row height (px)
const CENTER_Y = ROW_H / 2

// ─── Props ────────────────────────────────────────────────────────────────

interface CommitGraphProps {
  /** Columns for this commit's graph row */
  columns: GitGraphColumn[]
  /** Max number of columns across all graph rows — determines SVG width */
  maxColumns: number
}

// ─── CommitGraph ──────────────────────────────────────────────────────────

export function CommitGraph(props: CommitGraphProps) {
  const svgWidth = () => Math.max(props.maxColumns * CW + 4, 20)

  return (
    <svg width={svgWidth()} height={ROW_H} class="commit-graph-svg" aria-hidden="true">
      <For each={props.columns}>
        {(col) => {
          const cx = col.col * CW + CW / 2
          const color = getLaneColor(col.col)
          if (col.char === '*') {
            // Commit dot
            return <circle cx={cx} cy={CENTER_Y} r={DOT_R} fill={color} />
          }
          if (col.char === '|') {
            // Vertical line extending top-to-bottom of the row
            return <line x1={cx} y1={0} x2={cx} y2={ROW_H} stroke={color} stroke-width={STROKE_W} />
          }
          if (col.char === '\\' || col.char === '/') {
            // Diagonal — draw from edge to center
            const dir = col.char === '/' ? -1 : 1
            const x2 = cx + dir * CW
            return (
              <line
                x1={cx}
                y1={CENTER_Y - 6}
                x2={x2}
                y2={CENTER_Y + 6}
                stroke={color}
                stroke-width={STROKE_W}
                stroke-linecap="round"
              />
            )
          }
          if (col.char === '-' || col.char === '.' || col.char === '_') {
            // Horizontal/merging — line from column center left-ward
            return (
              <line
                x1={cx - 4}
                y1={CENTER_Y}
                x2={cx + 4}
                y2={CENTER_Y}
                stroke={color}
                stroke-width={STROKE_W}
                stroke-linecap="round"
              />
            )
          }
          return null
        }}
      </For>
    </svg>
  )
}
