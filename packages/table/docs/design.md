# Product design direction

## Character

Sheetbase Table should feel like a serious spreadsheet, not a dashboard containing a grid. The visual system is quiet, dense and precise: monochrome chrome, compact controls, hairline dividers and a single violet interaction colour. Source-specific colour appears only where it communicates provenance.

## Layout

- Menus and workbook title occupy a single 58px bar.
- Formatting controls occupy one 50px toolbar.
- The formula bar is always visible and compact.
- Data-source configuration is a collapsible left rail, not a modal workflow.
- Query results remain an ordinary sheet and can be referenced by ordinary formulas.
- Sheet tabs and zoom remain persistently available at the bottom.

## Formula interaction

References should communicate meaning, not only coordinates. When editing a formula:

- reference tokens receive stable colours;
- hovering or moving the caret highlights the corresponding range;
- a small provenance label names a structured field, such as `Result` or `Run date`;
- autocomplete ranks dataset fields before generic functions when context indicates a reference;
- suggestions show both the semantic field name and its sheet/query origin.

Coordinates remain visible because experienced spreadsheet users rely on them. Semantic labels augment them rather than replacing them.

## Data-source rail

The rail is a live query composer with:

- source and dataset identity;
- draggable typed fields;
- joined columns;
- filter, sort and limit sections;
- explicit query execution and row-count/runtime feedback.

The rail configures the projected dataset. Cell edits are governed separately by each field's writable status and the user's role.

## Density and typography

- Instrument Sans for interface text.
- Roboto Mono for formulas, addresses and machine identifiers.
- Default row height: 31px; compact mode can target 25–27px.
- Avoid oversized headings, cards, decorative gradients and excessive border radii.
- Use icons sparingly and consistently; data/provenance icons must have a legend or tooltip.

## Attribution

The interaction direction is closely inspired by publicly visible Equals product screens and its engineering article, “Building a High Performance Spreadsheet in the Browser”. The implementation is independent and should not copy proprietary assets or source code.
