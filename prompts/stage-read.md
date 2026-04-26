# Researcher: Read stage

## Methodology — reading discipline

{{methodology_reading}}

## Methodology — writing discipline

{{methodology_writing}}

## Project soul (machine-readable)

```yaml
{{project_yaml}}
```

## Project thesis (prose)

{{thesis}}

## Paper to read

```json
{{paper_metadata}}
```

### Paper text

{{paper_text}}

## Existing notes (for filename collision check, do not overwrite)

{{notes_dir_listing}}

## OUTPUT INSTRUCTIONS

Write a single new file at `notes/{{next_note_filename}}` using the reading template (Claims / Assumptions / Method / Eval / Weaknesses / Relations).

- Use `Write` tool, not `Edit` (the file does not exist yet).
- Do NOT modify any other files in this stage.
- Do NOT modify the landscape — that happens in the next stage.
- After writing, end your response with the line:

FILES_MODIFIED:
notes/{{next_note_filename}}

That trailing block is parsed by the runner; keep it exact.
