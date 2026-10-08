# Daily Tangle

A daily untangling puzzle. Drag the nodes until no two edges cross. Everyone gets the same puzzle for the day, and results can be shared by link.

Open `index.html` in a browser to play. The files can be hosted on GitHub Pages without a build step.

## Puzzle generation

`buildPlanarEdges` selects edges that do not cross at a known solution layout, then shuffles the nodes. This guarantees that a layout with no crossings exists.

The recorded check covered 60 seeds: every solution had zero crossings, and all 60 starting layouts had crossings.

## Daily puzzles and sharing

- The date determines the seed. The puzzle number counts days from the reference date.
- Use `?seed=<integer>` for practice puzzles.
- After solving a puzzle, copy its number, move count, and time to share your result.

## Implementation

Vanilla JavaScript and Canvas 2D, with no runtime dependencies. A seeded mulberry32 generator makes puzzles reproducible. WebAudio generates the sounds.

```text
index.html   Game interface and completion overlay
style.css    Mobile layout and dark theme
game.js      Graph generation, crossings, dragging, and sharing
BLUEPRINT.md Project scope and design notes
```

## Planned work

- Daily rankings, streaks, and share cards.
- Difficulty levels, hints, and cosmetic themes.
- A Three.js presentation with rotating 3D nodes.

## License

MIT.
