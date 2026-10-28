/**
 * `customType` of the entry the durable runtime writes where a navigated branch starts.
 *
 * It exists so the last line of the session file lies on the branch the session is on, before the
 * branch has a message. It is not a turn: the tree, the map and the trajectory skip over it.
 */
export const BRANCH_MARKER_TYPE = 'openpi.branch'
