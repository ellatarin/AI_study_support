# Comment style

This guide holds the rules for comments in this project's code. Each rule has a reason and an example. Read the guide before you write or change a comment.

The rules apply to `/** */` blocks, to `//` comments and to the file comment at the top of each file. Lint directives such as `eslint-disable-next-line` are not prose, and these rules do not apply to them.

## 1. A comment gives a fact that the code does not show

A comment is worth its place when it tells the reader one of these things:

- a reason that a reader would question, such as why `run` normalises the sources first
- a limit or a constraint, such as "the resolved path must be in this module root"
- the result in an edge case, such as "returns `null` when the user cancels"
- what a value means, such as "the number of lectures that a batch runs at once"
- a link to the design, such as "(technical-design.md §4.4)"

Delete a comment that only restates the code. These five kinds of comment restate the code:

| Kind | Example that is deleted |
|---|---|
| A comment on a constant that repeats the name | `MANIFEST_FILE`: "The manifest of a lecture is in this file in its workspace." |
| A comment on a short function that repeats the name | `moduleDirs`: "Returns the four folders of a module." |
| A comment on a type that repeats the fields | `StageInWorkspace`: "The functions that … take this workspace and stage." |
| A comment that repeats a fact from another comment | The `build-notes-page` line in `STAGE_FILES`, which repeats the table's own comment |
| A comment that walks through code that is easy to read | `runLectures`: "Runs the chosen lectures one after another, and writes the run summary of each." |

Each fact has one home. Write it on the function or type that it describes. Write the long form in the design document, and give a reference to it.

A comment describes the code as it is now. Leave the history to git.

## 2. A comment opens with a full sentence about a thing that acts

These three rules control the first sentence of each comment.

### Rule 2.1: Open with a full sentence

The first sentence has a concrete subject and a verb. Do not open with any of these:

- a noun phrase with an empty head: "The work of …", "The input of …", "Everything that …", "The stages that …"
- a verb with no subject on a value: "Does the work of a parsed command"
- a pronoun: "It is a mapped type …"

| Before | After |
|---|---|
| The input of a picker: the lectures that one lecture date names. | A picker shows the user the lectures on one lecture date, and the user chooses from them. |
| Everything that a command uses from outside this module. | A command reads its configuration and calls the runner, the prompts and the output stream through these fields. |
| It is a mapped type and not a `Pick`, because … | A `Pick` type includes the class's methods, and a type with methods is not deeply readonly. |

A comment on a function is the one exception. It opens with its verb, such as "Returns the folder …" or "Asks the user …". The function is the subject that the reader sees at once.

### Rule 2.2: Only a thing that acts is the subject of an action verb

The subject of an action verb is a thing that can act: the user, a command, a stage, a function, the runner or the compiler. Data never acts. A date, a path, a message, a manifest entry and a type do not name, choose, send or keep anything.

| Before | After |
|---|---|
| a lecture date that names no lecture | when no lecture is on the date |
| A failure message gives this path to the user. | A command shows this path to the user when a stage fails. |
| `Pick` keeps the class's methods | A `Pick` type includes the class's methods |
| so the files list in run order | so that a folder listing shows the files in run order |

### Rule 2.3: Use a verb that says the exact action

Do not use vague verbs such as "gets", "gives", "does", "makes" and "handles". Write the real action.

| Before | After |
|---|---|
| Gets the cost reports from the runner | Asks the runner for the cost reports |
| Does the `run` command | Runs the `run` command |
| Makes the picker | Builds the picker |
| Gives the modules that a command acts on | Returns the modules that a command acts on |

## 3. Exported functions take TSDoc, private functions take a short `//` comment

- **An exported function** takes a full TSDoc block: a one-line description, then an `@param` line for each argument, and `@returns` and `@throws` lines. A caller in another file sees only this block, in the editor's hover text.
- **A private function** takes a `//` comment of one to three lines that gives the reason or the edge case. The signature is directly under the comment, so `@param` lines would repeat it. A tag line that gives a fact, such as "`null` for every module", moves into the prose line.
- **A private function whose argument names do not explain the arguments** keeps a full TSDoc block. `withResolvedLectures` in `src/cli/commands.ts` is an example: the names `act` and `alsoTry` do not explain themselves.

A private function with no fact to give gets no comment.

| Before (9 lines) | After (1 line) |
|---|---|
| A TSDoc block on `scopedModuleRoots` with a description, three `@param` lines and an `@returns` line | `// Returns the module that the user named, or every configured module when moduleRoot is null.` |

## 4. What the gate forces

The lint rules in `eslint.config.js` force only part of the comment load:

- A `/** */` block on each exported function, class and type alias. The lint rules do not require text in the block.
- An `@param` line for each argument, and `@returns` and `@throws` lines, in each `/** */` block on a function. This applies to private functions too, when they have a `/** */` block. A `//` comment is not checked.
- No block on a constant, a field or a private function.

An exported type whose fields explain it still needs a block. Give it one short line that says who uses the type. An example is "The functions that find the output file of a stage take this workspace and stage."

The post-edit hook (`scripts/hooks/post-edit-ste-lint`) runs the STE linter on each comment that an edit writes. It also runs the word-pattern checks in `scripts/hooks/lib/comment-checks.mjs`, such as no history phrases and no question-word openings. The hook catches only part of this guide. Rules 1, 2.1, 2.2 and 2.3 need a human check.

## 5. Comments are written in STE

Each comment follows ASD-STE100, as the global rules for replies describe:

- short sentences, with one fact in each sentence
- common words
- no phrasal verbs and no semicolons
- each "it", "this" or "the rule" points to a thing that the reader sees at once, or the comment names the thing

Most comments have one to three lines.

## 6. Checklist

Before each commit that adds or changes a comment, read each changed comment against this list:

1. The comment gives a fact that the code does not show.
2. The fact has one home.
3. The first sentence has a concrete subject and a verb.
4. The subject of each action verb is a thing that acts.
5. Each verb says the exact action.
6. An exported function has TSDoc. A private function has a `//` comment or no comment.
7. The comment is in STE and has one to three lines.
