# Lecture Notes Generator — Requirements Specification

**Suite version:** 1.70-draft. The requirements, the technical design and the implementation plan share this number. A substantive edit to any of the three raises it in all three
**Date:** 2026-10-07
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

**FR-1.4** The system shall structure the raw transcript into a formatted markdown document, imposing logical organisation on the content (e.g. identifying topics, sections and key points).

### FR-2 — Slide Processing

**FR-2.1** The system shall accept a library of lecture slide files (PDF) as input.

**FR-2.2** The system shall read each slide: its title, its text, and a description of each diagram.

**FR-2.3** The system shall render each slide as one whole image, with a caption that says what the slide shows.

**FR-2.4** The system shall place each slide with the part of the lecture where the lecturer discusses it. The slides shall keep the order of the slide deck.

**FR-2.5** The system shall leave out each slide that holds no subject matter for a student, such as a title, outline or "questions?" slide.

### FR-3 — Content Synthesis

**FR-3.1** The system shall synthesise the structured transcript, the slide readings, and the slide images into a single unified set of notes for each lecture.

**FR-3.2** The synthesised notes shall cover all significant content present across the source materials, without omission.

**FR-3.3** The synthesised notes shall be rewritten in fluent, idiomatic British English.

**FR-3.4** The synthesised notes shall be written in a textbook style: coherent prose, well-organised sections, and academically appropriate language.

**FR-3.5** The system shall show each placed slide image, with its caption, in the synthesised notes at its place. The notes shall refer to each image as a separate file through a relative path, so that a person can read the output markdown.

### FR-4 — Quality Assurance

**FR-4.1** The system shall perform a quality check of the synthesised notes against all source materials (structured transcripts, slide readings, and slide images).

**FR-4.2** The quality check shall identify any significant content present in the source materials that is absent or inadequately represented in the synthesised notes.

**FR-4.3** The quality check shall identify areas where the synthesised notes have introduced any of the following:

- **factual errors** — claims that contradict statements in the source materials
- **unsupported claims** — statements not supported by any source material
- **clarity deficiencies** — passages that are factually correct but ambiguous, muddled, or otherwise difficult to follow

**FR-4.4** The system shall produce a revised output that addresses all deficiencies identified during the quality check.

**FR-4.5** The system shall repeat the quality check and revision cycle automatically until no deficiencies are identified, or until a configurable maximum number of iterations is reached.

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

**NFR-1.1** The synthesised notes shall be written in fluent British English, including correct British spelling and grammatical conventions.

**NFR-1.2** The synthesised notes shall be of a standard suitable for use as primary study material.

**NFR-1.3** The synthesised notes shall faithfully and accurately represent the academic content of the source materials without introducing errors or unsupported claims.

### NFR-2 — Cost Efficiency

**NFR-2.1** The system shall enable cost-optimised model selection by allowing lighter or cheaper models to be assigned to less demanding stages and more capable models to stages requiring higher reasoning or synthesis quality.

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
