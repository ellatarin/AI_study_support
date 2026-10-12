# Lecture Notes Generator — Requirements Specification

**Suite version:** 1.91-draft. The requirements, the technical design and the implementation plan share this number. A substantive edit to any of the three raises it in all three
**Date:** 2026-10-12
**Status:** For review

---

## 1. Purpose

The system shall take a set of lecture recordings (video files) and accompanying lecture slides (PDF files) and produce a set of high-quality, coherent notes that cover all content from both sources and read as a well-structured textbook chapter.

---

## 2. Functional Requirements

### FR-1 — Video Processing

**FR-1.1** The system shall accept a library of lecture video files as input.

**FR-1.2** The system shall extract the audio track from each video file and save it as a standalone audio file.

**FR-1.3** The system shall transcribe the extracted audio to text.

**FR-1.4** The system shall arrange the transcript as the lecture's structure. The structure holds the topics in lecture order, each with its title. Each topic holds its subtopics in order, each with its title and its own text. The text shall be the lecturer's words, unchanged.

### FR-2 — Slide Processing

**FR-2.1** The system shall accept a library of lecture slide files (PDF) as input.

**FR-2.2** The system shall read each slide: its title, its text, and a description of each diagram.

**FR-2.3** The system shall render each slide as one whole image, with a caption that says what the slide shows.

**FR-2.4** The system shall place each slide with the part of the lecture where the lecturer discusses it. The slides shall keep the order of the slide deck.

**FR-2.5** The system shall leave out each slide that holds no subject matter for a student, such as a title, outline or "questions?" slide.

### FR-3 — Rewriting

**FR-3.1** The system shall rewrite each subtopic of the lecture as prose, one subtopic at a time.

**FR-3.2** Before the rewrite, the system shall correct each misheard term in a subtopic against the readings of the slides placed in that subtopic. A correction shall change a term only. It shall never add or remove a fact.

**FR-3.3** The rewritten text shall keep each fact of the lecturer's words, in the lecturer's order, and add none.

**FR-3.4** The rewritten text shall be written in fluent, idiomatic British English, in a textbook style: coherent prose and academically appropriate language.

**FR-3.5** The system shall produce the notes of each lecture as one HTML page. The page shall show the rewritten subtopics under their topic and subtopic titles. It shall show each placed slide image, with its figure number and caption, at its place.

### FR-4 — Quality Assurance

**FR-4.1** The system shall check each rewritten subtopic against the lecturer's words for that subtopic and against the term corrections made in it.

**FR-4.2** The check shall identify any content of the lecturer's words that is absent from the rewritten subtopic.

**FR-4.3** The check shall identify places where the rewritten subtopic has introduced any of the following:

- **factual errors** — claims that contradict the lecturer's words
- **unsupported claims** — statements that the lecturer's words do not carry
- **wrong corrections** — term corrections that change a fact, or that change a term to a wrong one.

**FR-4.4** When the check finds a fault, the system shall correct the terms and rewrite the subtopic again. It shall give each fault to the step that it concerns.

**FR-4.5** The system shall make at most a configured number of attempts at each subtopic, three by default. When the last attempt fails the check, the system shall stop and report the subtopic and its faults.

### FR-5 — Model Configurability

**FR-5.1** The system shall allow a different AI model to be specified independently for each processing stage.

**FR-5.2** The system shall support switching the model used at any stage without affecting the behaviour of other stages.

**FR-5.3** The system shall provide access to a broad range of AI models, including both commercial and open-source options.

### FR-6 — Pipeline Operation

**FR-6.1** The system shall be operable from the command line.

**FR-6.2** The system shall support processing a single lecture or a batch of lectures.

**FR-6.3** The system shall persist the intermediate output of every pipeline stage to disk.

**FR-6.4** The system shall support re-running the pipeline from any stage without re-executing completed upstream stages.

**FR-6.5** The system shall provide clear progress feedback to the user at each stage of the pipeline, including upload progress bars where large files are being transferred.

**FR-6.6** The system shall identify each lecture by its date, number lectures sequentially in date order within a module, and renumber the affected lectures automatically when a lecture is added or removed.

**FR-6.7** The system shall provide commands to rename a lecture, delete a lecture, and change a lecture's date, keeping its source files, workspace, and outputs consistent with one another.

---

## 3. Non-Functional Requirements

### NFR-1 — Output Quality

**NFR-1.1** The notes shall be written in fluent British English, including correct British spelling and grammatical conventions.

**NFR-1.2** The notes shall be of a standard suitable for use as primary study material.

**NFR-1.3** The notes shall faithfully and accurately represent the academic content of the source materials without introducing errors or unsupported claims.

### NFR-2 — Cost Efficiency

**NFR-2.1** The system shall enable cost-optimised model selection by allowing lighter or cheaper models to be assigned to less demanding stages and more capable models to stages requiring higher reasoning or writing quality.

**NFR-2.2** The system shall report the API cost incurred at each stage of each pipeline run, and shall report a stage whose cost could not be established as unknown rather than as nothing. Stage costs are reported one stage at a time, since what the figures are for is comparing a stage's models against each other; the system totals them nowhere.

**NFR-2.3** The system shall present all costs to the user in pounds sterling, converted at a configurable rate from the US dollar amounts providers charge.

### NFR-3 — Traceability

**NFR-3.1** Each output file shall be clearly associated with the source lecture and the pipeline stage that produced it.

**NFR-3.2** The system shall maintain a record of which model and which configuration was used at each stage for each run.

### NFR-4 — Reliability

**NFR-4.1** A failure at any pipeline stage shall not cause the loss of outputs already produced by earlier stages.

**NFR-4.2** The system shall report failures clearly, including which stage failed and why.

**NFR-4.3** The system shall not irreversibly delete pipeline work without explicit user confirmation; where confirmation is declined, the system shall make no changes at all.

### NFR-5 — Maintainability

**NFR-5.1** Each pipeline stage shall be independently configurable and testable in isolation.

**NFR-5.2** Adding a new pipeline stage or modifying an existing one shall not require changes to unrelated stages.

**NFR-5.3** The system shall be sufficiently modular that the orchestration layer makes it straightforward to alter the order in which stages are executed where appropriate.
