# Lecture Notes Generator

The tool turns each lecture's video recording and slide deck into one set of textbook-quality notes. Transcription is not the difficult part. The difficult part is to lose nothing and invent nothing between what the lecturer said and what the student reads.

## Language

### The material

**Module**:
A taught university module. Its lectures are processed together as a set. Everything else is scoped within a module.
_Avoid_: course, subject, class

**Lecture**:
One taught session. The date of delivery identifies it within its module.
_Avoid_: session, class, recording, video

**Video recording**:
The video file of one lecture as it was delivered. The audio for transcription comes from it.
_Avoid_: video (alone), recording (alone), source video

**Source pair**:
The video recording and the slide deck of one lecture. Every lecture has exactly one of each, matched by date. A lecture that does not have both cannot be processed.
_Avoid_: inputs, raw files, assets

**Workspace**:
The folder that holds everything one lecture collects on its way through the pipeline, from audio to finished notes. The folder takes its name from the lecture. When a lecture is renumbered, the folder is renamed and nothing inside it changes.
_Avoid_: output directory, working directory, scratch folder

**Processing folder**:
The folder in a module that holds the workspaces of all its lectures.
_Avoid_: output folder, pipeline folder

**Final output folder**:
The folder in a module that holds the notes PDFs of all its lectures. The config section `finalOutput` holds the settings for them.
_Avoid_: notes folder, output folder

**Transcript**:
The verbatim text of what was said, as the transcriber produced it. It has no spelling of its own, because speech has none.
_Avoid_: raw transcript (except where contrasted with the structured transcript), captions

**Structured transcript**:
The transcript reorganised into headed, readable prose, with filler removed. From synthesis onwards, the structured transcript is the lecture. No stage reads the verbatim transcript again. That is why the structured transcript is checked against its source exactly once.
_Avoid_: cleaned transcript, formatted transcript

**Notes**:
The finished document for one lecture: continuous academic prose with figures, key-concept summaries and a glossary, delivered as a PDF. It is the only artefact a student is meant to read.
_Avoid_: summary, write-up, output, document

### A lecture's identity

**Lecture date**:
The day a lecture was delivered. It is unique within its module, and a user names a lecture by it. Identity rests on the date and not on a title, because a title can change, and does.
_Avoid_: id, key, slug

**Lecture number**:
A lecture's position in its module, in date order. Adding an earlier lecture renumbers every later one. So the number is a derived fact, not a stable identifier.
_Avoid_: index, sequence number

**Provisional title**:
The title taken from the lecturer's own filename. It is a best guess and can be empty. A later stage judges whether it is any good.
_Avoid_: draft title, filename title

**Module prefix**:
A module code or module name that a lecturer puts at the start of a filename, such as `BOD_` or `Biology of Disease - `. Normalisation removes it when it takes the provisional title from the filename. The config file lists the module prefixes.
_Avoid_: prefix (alone), module code

**AI-derived title**:
A replacement title proposed from the transcript. A stage proposes one only when it judges the provisional title not meaningful. A title the lecturer wrote on purpose is authoritative, so most lectures never get an AI-derived title.
_Avoid_: generated title, suggested title

**User title**:
A title the user sets explicitly. It outranks both other kinds, and nothing overwrites it.
_Avoid_: manual title, override

**Lecture title**:
The title in force: the user title if set, otherwise the AI-derived title, otherwise the provisional title. It is always present, so no later stage has to ask which kind it got.
_Avoid_: name, display title, effective title

**Base name**:
The one name that a lecture's video recording, slide deck, workspace and PDF share. To rename a lecture, all four move to one new name together.
_Avoid_: filename, stem, prefix, canonical name, folder name, lecture name

**Lecture identity**:
A lecture's date, number, titles and base name, as its manifest records them. An identity change changes them and moves the files that carry the base name. Rename, delete and change-date are identity changes.
_Avoid_: identity mutation

### Running the pipeline

**Stage**:
One unit of work in the fixed sequence that takes a source pair to finished notes. A stage is resumable. If its output already stands, it does not do the work again.
_Avoid_: step, phase, task, job

**Normalisation**:
The whole-module pass that reads the source folders, dates and numbers the lectures, gives everything its base name, and creates any missing workspace. It covers the whole module because numbering runs across the module. One new lecture can change the number of every later one.
_Avoid_: ingest, import, setup, scan

**Source rule**:
A condition that normalisation checks before it changes anything. The rules are:
- every source file has a lecture date
- no two video recordings, and no two slide decks, share a date
- every video recording has a slide deck of the same date, and every slide deck has a video recording.

One broken rule stops normalisation. Normalisation reports every broken rule.
_Avoid_: anomaly, problem, undateable

**Deletion confirmation**:
The questions the tool asks before it deletes orphaned workspaces. It asks once for each lecture, then once more for all of them. If any answer is no, nothing is deleted.
_Avoid_: deletion protocol, direct-deletion guard

**Invocation**:
One start of the command-line tool. It can cover one lecture or a batch. It writes one debug log.
_Avoid_: launch, process

**Pipeline run**:
The work that one invocation does on one lecture. A pipeline run reports whether it failed. It does not report how far the lecture has got. The manifest records that.
_Avoid_: run (alone, since a splitting run is something else), lecture run, execution, job

**Bounded run**:
A pipeline run told to stop after a named stage (`--to-stage`). It does not reach the stages after that one. The lecture stays resumable.
_Avoid_: partial run

**Reset**:
Clearing the work of a stage and of every stage after it, so that `--from-stage` runs them again. The cleared stages go back to pending.
_Avoid_: wipe, clean

**Run type**:
The reason a pipeline run started. The runner decides the run type from the manifest when the run starts.
- *Normal*: no `--from-stage`.
- *Experiment*: `--from-stage` on a settled stage. The stage makes its output again, to compare with the first.
- *Error-recovery*: `--from-stage` on any other stage.

_Avoid_: run classification, mode

**Batch**:
The pipeline runs of one invocation across many lectures, and possibly many modules, taken from one queue.
_Avoid_: bulk run, batch run, sweep, campaign

**Manifest**:
A lecture's own record: its identity, how far each stage has got, and what each stage cost. The manifest is authoritative for a lecture's title, cost and history. The filesystem is authoritative for whether the lecture exists at all.
_Avoid_: state file, metadata, db, run manifest

**Stage entry**:
One stage's part of the manifest: its status, the settings it ran with, what it cost and the files it wrote.
_Avoid_: manifest entry, stage map (for one entry)

**Stage record**:
A small file that a stage writes beside its output. It says how the stage reached the output: which run the panel chose and why, or which titles changed. It is cleared with the output, so the two cannot disagree.
_Avoid_: record (alone, since the manifest is a lecture's record)

**Run log**:
The append-only record of one pipeline run, kept as the financial audit trail. It includes the attempts that failed. That is why it is kept apart from the manifest.
_Avoid_: history, audit file, journal

**Debug log**:
The diagnostic log of one invocation. It holds every call and the stack trace of every failure. It is not a run log: it records what happened, not what was spent.
_Avoid_: log (alone)

**Cost report**:
The report of what a lecture's stages cost, built from its manifest and run logs. It has three sections: the current output, error recovery, and experiments.
_Avoid_: spending report

**Run summary**:
The table printed after a pipeline run. It has one row for each stage that ran, with the stage's model, calls, tokens and cost. A batch also ends with a **batch summary**.
_Avoid_: end-of-run report

**Settled**:
A stage is settled when its output is on disk, whether this pipeline run made it or an earlier one did. The runner does not run a settled stage again, and does not pay for it twice. Say "settled" only of output. A title or identity that a stage chooses is *decided*.
_Avoid_: done, cached, finished

**Orphaned workspace**:
A workspace whose source pair was deleted directly, not through the tool. The tool never deletes one silently. Deleting an orphaned workspace is the only action here that destroys a user's work for good.
_Avoid_: orphan (alone, since it is also avoided for a singleton), stale workspace, dangling folder

**Unknown cost**:
The cost the tool records when it cannot establish what a stage spent. An unknown cost is never zero and never blank. A failed lookup and a call that cost nothing are different facts. Treating them as one corrupts the only spending record there is.
_Avoid_: missing cost, null cost, unresolved cost, zero

### Calling a model

**Send**:
One attempt at a model call. A call is sent at most three times. The pauses between sends are two seconds, then four. Every send is billed.
_Avoid_: try, request (for one attempt)

**Resend**:
Sending a call again after a provider error or an unusable reply.
_Avoid_: retry loop

**Provider error**:
An error that the model provider reports. It can arrive as a failed request, or inside a reply that the request accepted. If a reply holds a whole answer as well as a provider error, the stage keeps the answer and does not resend.
_Avoid_: refusal, rejection

**Unusable reply**:
A reply that a stage cannot use, because it is empty, is not JSON, or is not the shape the prompt asks for. In initial subtopic splitting, a reply is also unusable if it has a subtopic start that the transcript does not contain.
_Avoid_: bad reply, invalid reply

### Checking quality

**Faithfulness**:
The standard the output must meet: it carries everything the sources carry, and it asserts nothing they do not. Both halves matter. Their failures are opposite, and so are their remedies.
_Avoid_: accuracy, correctness, fidelity (reserved below for the segmentation sense)

**Checker**:
The call that reads an output against its source and reports what is wrong with it. It is kept apart from the reviser, because one model cannot be fully critical and write fluent prose at the same time.
_Avoid_: reviewer, critic, validator, judge

**Reviser**:
The call that makes targeted fixes for the deficiencies a checker raised. It works only from the lecture's own sources. It edits. It does not rewrite.
_Avoid_: fixer, editor, rewriter

**Deficiency**:
One fault that a checker found. It says what is wrong, how bad it is, where it is in the output, and which passage of the source it is about.
_Avoid_: finding, issue, error, bug, defect, problem

**Deficiency type**:
The kind of fault a deficiency is. Omission, underexplained, distortion and unsourced addition are faults of faithfulness. Clarity, British English, formatting and figure reference are prose faults. "Other" is the type of a deficiency that fits none of these.
_Avoid_: category

**Verification report**:
The file that transcript verification writes. It holds the checker's verdict, its coverage score, its deficiencies and its considerations. The readable view is a copy of it.
_Avoid_: findings report, QA report

**Prose fault**:
A deficiency in how the output is written, such as clarity, spelling or formatting, and not in its faithfulness to the source.
_Avoid_: style issue, writing error

**Consideration**:
Something a checker examined and decided is *not* a fault, with its reason. A list of deficiencies alone cannot tell a checker that missed something from one that looked and cleared it. Only the first is a reason to distrust the checker. That is why considerations are recorded.
_Avoid_: dismissed item, non-issue, false positive

**Omission**:
Source content that is absent from the output. The remedy is to put it back.
_Avoid_: gap, missing content

**Underexplained**:
Source content that is present but has lost the mechanism or reasoning that made it usable. It is not an omission, because nothing is missing except the *why*.
_Avoid_: oversimplified, too brief, shallow

**Distortion**:
The output asserts something that its source contradicts. The remedy is to fix it against the source.
_Avoid_: hallucination, inaccuracy, error

**Unsourced addition**:
Content in the output that the source does not carry at all. The remedy is to delete it. Never look for another source to support it, because that leads to invented citations. It is kept apart from distortion because the two look alike in a report, and their remedies are opposite.
_Avoid_: hallucination, invention, embellishment

**QA loop**:
The repeated cycle of check, then revise, that the notes go through. It stops when a checker passes the notes, when the iteration limit is reached, or when the deficiencies stop changing.
_Avoid_: review cycle, polish pass, refinement

### Dividing a transcript

*Words for the segmentation work, which changes the unit of work from the whole transcript to one part of it at a time. Separate model calls find two levels: the transcript is cut into subtopics, and the subtopics are then grouped into topics.*

**Subtopic**:
The finer of the two levels. A subtopic is one continuous stretch of transcript on a single point, and the transcript is cut into subtopics. A subtopic is fixed once cut. Nothing that groups subtopics afterwards may split one, merge two, reorder them or change their text.
A subtopic is one thing, together with what the lecturer brings to bear on it: its mechanism, what it causes, and the conclusion it supports. A move from a thing to its mechanism, from a cause to its effect, or from a claim to its evidence stays inside the subtopic. A move to a different thing, such as another mechanism or another agent, starts a new subtopic. This is true even when all of them serve the same larger point.
Cases that illustrate a point stay with it. The exception is when each case is a substantial passage on its own: then every case becomes a subtopic, never only some. The lecture's opening framing is a subtopic of its own, and so is its closing housekeeping.
_Avoid_: section, block, topic block, chunk, segment

**Topic**:
The coarser of the two levels: a major division of the lecture, made of consecutive subtopics. A lecture has as many topics as its material supports. The number is never fixed in advance.
_Avoid_: theme, part, chapter, heading

**Division**:
An ordered list of subtopics that covers the whole transcript, each with its title and reason. A splitting run makes a division. A chosen division and a ruled division are kinds of division.
_Avoid_: segmentation, split (as a noun)

**Division stages**:
The four stages that divide the transcript and group it: initial subtopic splitting, deepening, choosing the division, and grouping into topics. Retitling runs between the last two. It is not a division stage, because it changes only titles.
_Avoid_: segmentation stages

**Subtopic start**:
The words a model returns to show where a subtopic starts. The code finds these words in the transcript and puts the cut there. So the model never returns the text of a subtopic.
_Avoid_: opening, quote, opening words

**Reason**:
A model's grounds for making a subtopic or topic one thing, stored beside its title.
_Avoid_: rationale, justification

**Cut**:
A position where the transcript divides between two subtopics. A model is asked for cuts, and a vote keeps or discards them. A model is never asked for the text. The code slices the text from the original, so asking cannot lose or reword anything. Every topic division falls on a cut, because a topic is a whole number of subtopics.
_Avoid_: boundary, split, break point

**Cut site**:
A place in the lecture where splitting runs cut. Cuts from different runs that lie within about one percent of the lecture's length of each other are one cut site. This is because runs rarely choose the same word. Support is counted per cut site, never per cut.
_Avoid_: boundary, cluster, seam

**Initial subtopic splitting**:
The call that cuts the whole transcript into subtopics in one go, before any deepening. "Splitting" names the act of dividing. The place where it divides is still a cut.
_Avoid_: pass one, first pass, first cutting

**Deepening**:
The stage after initial subtopic splitting. It takes only the subtopics that came out above the size gate, and asks where each one divides further. It can add cuts inside a subtopic. It can never move or lose a cut already made, so nothing under the size gate can change. A call that fails every send makes the whole splitting run void. It never counts as "this subtopic does not divide".
_Avoid_: refinement, second pass, pass 1.5, recursion

**Deepening round**:
One pass of deepening over every subtopic still above the size gate. There are at most two rounds. The second runs only if the first cut something.
_Avoid_: round (alone), pass

**Size gate**:
The word count above which a subtopic goes to deepening. Code counts it, not the model, because a model can only estimate length by eye.
_Avoid_: gate (alone), threshold, limit

**Splitting run**:
One complete attempt at dividing one lecture into subtopics: initial subtopic splitting, then deepening. A panel is made of splitting runs. Between the two parts, call it "a splitting run before deepening".
_Avoid_: run (alone, since a pipeline run is something else), initial run, deepened run, trial, sample

**Grouping**:
The separate call that assembles finished subtopics into topics. It is kept apart from cutting because subtopics stay steady across splitting runs and models, but their grouping does not.
_Avoid_: clustering, merging, roll-up

**Grouping run**:
One attempt at grouping one lecture's finished subtopics into topics. It is separate from a splitting run. It is repeated for the same reason: the grouping of the same subtopics varies from one attempt to the next.
_Avoid_: run (alone), trial

**Chosen grouping**:
The grouping that the most runs of the grouping panel made. It is handed on whole: its topics and their titles are one run's reading of the lecture. Two runs made the same grouping if their topics start at the same subtopics, whatever titles they gave. The panel chooses as follows:
1. The grouping made by the most runs wins.
2. If two or more groupings tie, each made by more than one run, the one with more topics wins.
3. Next, the grouping whose topic starts differ least from the panel's vote wins. This applies if no grouping was made by more than one run, or if the tied groupings have the same number of topics.
4. If that still ties, the earliest run wins.

The vote itself is never handed on, because it could assemble a grouping that no run made.
_Avoid_: modal grouping, consensus, voted grouping

**Panel**:
A set of repeated runs over one lecture: splitting runs or grouping runs. The panel hands on one run's result whole. A splitting panel hands on the run nearest the vote, the **chosen division**. A grouping panel hands on the grouping most runs made, the **chosen grouping**. A panel makes a prompt that is usually right give a result that is reliably right.
_Avoid_: sample, ensemble, trial set

**Panel stage**:
A stage that makes a panel: initial subtopic splitting, deepening, and grouping into topics. A panel stage saves each run when it completes. So a panel stage that fails and starts again makes only the runs it lacks.
_Avoid_: panel step

**Saved run**:
One run of a panel, kept in its own numbered file in the panel stage's folder.
_Avoid_: run file (in prose)

**Support**:
The number of a panel's runs that made a choice, given as a count out of the panel. For a cut site, it is how many splitting runs cut there ("6 of 9"). For a topic start, it is how many grouping runs start a topic at that subtopic ("3 of 5").
_Avoid_: votes (as a count), supporters, frequency

**Bar**:
The support that a cut site or a topic start needs to be kept. Each panel has its own bar.
_Avoid_: threshold, cutoff, quorum

**Kept**:
A cut site or topic start is kept when its support reaches the bar. The vote is the set of kept cut sites or topic starts. The panel's runs are measured against the vote. The vote is never a division or grouping of its own.
_Avoid_: accepted, passed

**Chosen division**:
The splitting run whose cut sites differ least from the vote. It is handed on whole: its subtopics, titles and reasons are one run's reading of the lecture. If two runs tie, the run closest to the others wins, then the earliest.
_Avoid_: voted division, voted subtopics, best run

**Title**:
The short name of a subtopic or topic, which says what it is about. A reader sees titles as the headings of the notes. A topic of one subtopic shows only the topic's title.
_Avoid_: label, heading, name

**Inherited title**:
The title a subtopic keeps from the larger subtopic that deepening cut it from. Deepening gives titles only to the new pieces it makes. So the first piece keeps the title of the whole, which can promise material that the later pieces now hold. Retitling replaces it, as it replaces every title.
_Avoid_: stale title, old label

**Retitling**:
Giving every subtopic of the chosen division a new title from its own text. It is one pass over the whole lecture, before grouping, so that grouping sees the new titles. A subtopic that recaps earlier material gets a summary title. The lecture's closing part is titled as its summary or close. Only titles change. No cut moves.
_Avoid_: relabelling, renaming

**Losslessness**:
The guarantee that a divided transcript is still the original transcript. Its subtopics, joined in order, are the transcript character for character. Any difference is a bug, never a tolerance.
_Avoid_: fidelity, accuracy, integrity

#### Measuring the division

*Words for judging how well splitting and grouping work. The pipeline does not use them. They belong to testing a prompt or a model.*

**Segmentation prototype**:
The test harness in which each splitting and grouping prompt was measured, before it was copied word for word into the pipeline. Its rulings, rubrics and scores stay there. A run of it is a *prototype run*.
_Avoid_: prototype (alone, where another could be meant), harness

**Unanimous** / **Contested** / **Rare**:
The three classes of cut site, by how their support compares with the bar.
- Unanimous: every splitting run cut there.
- Contested: its support is so close to the bar, on either side, that the bar decides it and not the model.
- Rare: a quarter of the runs or fewer cut there.

_Avoid_: strong, weak, borderline, noise

**Singleton**:
A topic made of exactly one subtopic. A singleton is not wrong in itself, but the rate of singletons is watched. A grouping that returns mostly singletons does not really group anything.
_Avoid_: orphan, lone topic

**Consistency**:
A measure of how alike a panel's splitting runs are. For each pair of runs, take the share of their cut sites at which both cut. Consistency is the average over every pair. It needs no ruled division, so it can be measured on any lecture. Scoring is different: it asks whether a division is right, and it needs a ruled division.
_Avoid_: agreement, stability, reliability

**Ruled division**:
The user's hand judgement of how one lecture divides into subtopics. It says which cuts are right, which are wrong, and which the user is content to do without. The cutting is scored against it. Nothing in it is inferred.
_Avoid_: ground truth, gold standard, expected output

**Rubric**:
The topic-level partner of a ruled division. It names the things that one lecture's grouping must get right, taken from the user's critique of a grouping run. A lecture with no rubric of its own is unjudged, not failed. Its grouping runs are scored neither pass nor fail.
_Avoid_: criteria (as a bare noun), checklist, test cases

## In the code

*Words for how the code is built, not for the problem it solves. Each is also documented where the code defines it.*

**Runner**:
The code that drives a pipeline run. It runs a lecture's stages in order and skips settled ones. It writes each stage entry and the run log. It also carries out resets and bounded runs.
_Avoid_: orchestrator, engine

**Stage context**:
The data a stage receives about its lecture: the lecture identity, the workspace, the configuration and a copy of the manifest. A stage only reads it. The runner builds a new one after each stage. This is because a stage can change the lecture's title, and with it the workspace path.
_Avoid_: lecture run context, state

**Span**:
A subtopic's place in the transcript, stored as the character positions where it starts and ends. The code stores spans and not text, so a division cannot change the transcript.
_Avoid_: range, segment

**Position**:
The thing a panel vote counts. A splitting panel counts cut sites. A grouping panel counts topic starts.
_Avoid_: mark, candidate

**Connective**:
A word such as "So" or "And" that opens a sentence. A model often leaves it out of a subtopic start. The code moves the cut back over it, so that it stays with the subtopic it opens.
_Avoid_: hinge word

**Tuning**:
A stage's model settings other than the model itself: temperature, token limit, and how many runs or calls go at once.
_Avoid_: parameters (alone), knobs

**Send gate**:
The timer that keeps a stage's sends apart. Each send waits until a set time has passed since the stage's previous send began. Always write "send gate". "Gate" alone is the size gate.
_Avoid_: gate (alone), throttle

**Verdict**:
A checker's overall pass or fail on an output. A model's decision on whether a provisional title is meaningful is a *title judgement*, not a verdict.
_Avoid_: result, outcome

**Item**:
One of the four things that share a lecture's base name: its video recording, its slide deck, its workspace and its PDF. A rename moves all four.
_Avoid_: asset, entry

**Readable view**:
A copy of a stage's output, written for a person to read, beside the file that the next stage reads. Only transcript verification writes one. It is temporary, and will be deleted once the checker is calibrated.
_Avoid_: report (for the copy), rendering
