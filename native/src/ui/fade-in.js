// Whether a view keyed by `key` fades in on this render: only when one defined key changes to
// another. `previous` is the key last rendered (the key itself on first mount, so that never
// fades). An undefined key means not ready yet, so neither going to one nor leaving one (opening
// the screen) fades. Pure; use-fade-in.js turns the answer into Reanimated's `entering`.
export const fadesIn = (previous, key) => previous !== undefined && key !== undefined && previous !== key
