# UI / UX decisions — ExpenseFlow 0.3

ExpenseFlow is intentionally an application, not a mobile screen stretched across desktop. The redesign keeps the code dependency-free while using established information-architecture and data-table patterns.

## Information architecture

- **Desktop:** persistent left navigation because larger screens should expose application navigation rather than hide it.
- **Desktop primary action:** one **Add expense** button directly below the ExpenseFlow brand.
- **Mobile:** compact bottom navigation with **Add** as the central action; the desktop sidebar is removed.
- **Brand:** ExpenseFlow always links to Overview.
- **Secondary tools:** Favorites, recurring expenses, categories/rules, backup and settings live under More.

## Add and bulk review

- Input stays simple: paste one or many lines, then parse.
- After parsing, the original input collapses so review gets the screen space.
- Desktop review uses a dense editable table for the fields people scan most.
- Mobile review uses short summary rows; full details open only when needed.
- **Save all** remains sticky with count, total and warning count.
- Items needing attention are visually highlighted.

## Transactions

- Search is always visible.
- Today / This week / This month / All time are one-tap filters.
- Less-common filters stay behind a visible Filters control.
- Applied filters remain visible as chips.
- Desktop uses a data table for fast comparison; mobile uses compact records.
- Batch selection exposes a contextual delete action.
- Long descriptions are truncated visually, not in stored data.

## Overview / stats

The first screen answers four questions before showing detail:

1. What can I still safely spend?
2. How much have I spent?
3. How much have I saved?
4. How much income has actually arrived?

Supporting visualizations then show income vs spending, category mix, daily spending, payment split and budget progress.

## Settings

Settings use consistent two-column label/control rows on desktop and stack on small screens. Only controls that change real application behavior are displayed.

## References

- Nielsen Norman Group — Menu Design Checklist: visible navigation on larger screens and expected placement for application menus.
  https://www.nngroup.com/articles/menu-design/
- Nielsen Norman Group — Beyond the Hamburger: exposed desktop navigation improves discoverability.
  https://www.nngroup.com/articles/find-navigation-desktop-not-hamburger/
- Nielsen Norman Group — Data Tables: tables support finding, comparing, editing and acting on records.
  https://www.nngroup.com/articles/data-tables/
- Carbon Design System — Data table: search/filter toolbar, compact rows, selection, expansion and batch actions.
  https://www.carbondesignsystem.com/components/data-table/usage/
- Carbon Design System — Filtering: applied filters should remain visible and be easy to clear.
  https://www.carbondesignsystem.com/patterns/filtering/

These sources inform interaction patterns only; ExpenseFlow remains a small local-first product with no UI framework dependency.
