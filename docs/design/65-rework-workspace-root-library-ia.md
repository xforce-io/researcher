# 65 · Rework Workspace Root and Library IA

Issue: https://github.com/xforce-io/researcher/issues/65

## Problem

The web console has grown from a topic dashboard into a workspace product, but
the route model still treats topic cards as the root experience. The Library
also keeps selected-paper detail inside `/library?paper=...`, which makes the
paper workspace feel like a side panel rather than a first-class route.

Current evidence:

- `/` renders topic cards directly.
- `/topics` does not exist.
- `/library/p/:paperId` redirects to `/library?paper=:paperId`.
- Library list, selected paper details, read action, relations, and mini-map all
  compete in one shell.

## Decision

Make the workspace the primary mental model:

- `/` is Workspace Home: a compact operational overview with entry points into
  Library and Topics.
- `/topics` is the topic list previously shown at `/`.
- `/library` is the Library overview and paper list.
- `/library/p/:paperId` is the canonical paper detail route.
- `/library?paper=:paperId` remains a compatibility redirect to
  `/library/p/:paperId`.
- `/t/:slug` remains the topic workspace.

## Information Architecture

### Workspace Home (`/`)

Home should answer "what is happening in this workspace?" rather than listing
every topic as the whole page.

It shows:

- active/available/dormant topic counts;
- Library paper/read counts;
- a compact active topic preview linking to `/topics` and `/t/:slug`;
- recent or actionable Library state, including unread/reading/read counts;
- top-level navigation to Workspace, Library, and Topics.

### Topics (`/topics`)

The current dashboard card grid moves here. Topic cards keep their existing
behavior and links to `/t/:slug`.

### Library Overview (`/library`)

The Library page should focus on intake and selection:

- header contains title and Add paper action;
- left rail contains search/filter affordances and the paper list only;
- no selected-paper inspector is rendered on `/library`;
- paper rows link to `/library/p/:paperId`.

Search/filter controls can be static in this issue; behavior can follow later.
The main requirement is layout clarity and route separation.

### Paper Detail (`/library/p/:paperId`)

Paper detail becomes a first-class page:

- center: paper identity, read artifacts, and main read surface summary;
- right: actions and inspector sections for Deep read, Relations,
  Integrations, and Mini map;
- back link to `/library`;
- unknown paper ids return 404.

The existing Deep read form posts to `/library/read`; after starting a read it
redirects back to the canonical paper route.

## Compatibility

- `/library?paper=:paperId` redirects to `/library/p/:paperId`.
- Existing `/t/:slug` topic routes and run/doc/paper subroutes stay unchanged.

## Implementation Scope

- `src/web/discovery.ts`
  - Add workspace summary model.
  - Keep topic list model usable by `/topics`.
  - Split Library overview from paper detail model.
- `src/web/server.ts`
  - Route `/` to workspace home.
  - Add `/topics`.
  - Make `/library/p/:paperId` canonical.
  - Redirect `/library?paper=:paperId` to canonical detail.
  - Redirect Library read completion to canonical detail.
- `src/web/views.ts`
  - Add shared top navigation.
  - Add workspace home view.
  - Keep topic cards under a topics view.
  - Rework Library overview and paper detail layout.
- `src/web/static/app.css`
  - Add styles for workspace home, nav, library list rail, and paper detail.
- Tests
  - Server tests for new routes and redirects.
  - Discovery tests for workspace summary.
  - View tests for nav, home, topics, Library overview, and paper detail.

## Non-goals

- Editing topics, relations, tags, or filters.
- Full-text search implementation.
- Changing topic workspace behavior.
- Changing Library storage format.

## Acceptance Criteria

- `GET /` renders Workspace Home and does not render the old topic-card grid as
  the primary page.
- `GET /topics` renders the topic card grid.
- `GET /library` renders the Library overview with list/search/filter rail and
  no selected-paper inspector.
- Paper links point at `/library/p/:paperId`.
- `GET /library/p/:paperId` renders the paper detail page.
- `GET /library?paper=:paperId` redirects to `/library/p/:paperId`.
- Starting a Library deep read redirects back to `/library/p/:paperId`.
- Existing topic routes still work.
- `npm run build` and `npm test` pass.
- Browser verification covers `/`, `/topics`, `/library`,
  `/library/p/:paperId`, and an existing `/t/:slug` page.
