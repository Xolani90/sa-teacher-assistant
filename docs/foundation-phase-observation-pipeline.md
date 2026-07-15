\# Foundation Phase Observation Pipeline



\## Status



\*\*Proposed architecture only. Not implemented.\*\*



This document captures the architectural findings from the repository audit

performed after completing the Grade R and Foundation Phase migrations.



\## Problem



The current diagnostic assessment pipeline is built entirely around numeric

marks.



Current flow:



```

Teacher Upload

&#x20;     ↓

marksParser

&#x20;     ↓

itemAnalysisService

&#x20;     ↓

errorAnalysisService

&#x20;     ↓

learnerGroupingService

&#x20;     ↓

interventionPlanService

&#x20;     ↓

interventionReportsService

```



This architecture assumes every learner has:



\- mark

\- total\_marks

\- percentage

\- question-level scores



Those assumptions are valid for Grades 1–12 but not for Grade R.



\---



\## Repository Evidence



Repository audit identified the following constraints:



\- marksParser accepts only numeric assessment data.

\- itemAnalysisService performs percentage calculations.

\- learnerGroupingService groups learners using percentage thresholds.

\- errorAnalysisService depends on numeric performance metrics.

\- learner\_results requires mark, total\_marks and percentage.

\- assessments requires total\_marks.

\- routes/webhook.js currently drives the numeric assessment workflow.



These components cannot correctly represent observational assessment data.



\---



\## Grade R Requirements



Grade R assessment is observation-based rather than marks-based.



Typical evidence includes:



\- developmental milestones

\- oral responses

\- practical activities

\- teacher observations

\- continuous assessment



These do not naturally map to percentages.



\---



\## Proposed Architecture



Introduce a separate observation pipeline instead of modifying the existing

marks pipeline.



```

Teacher Observation

&#x20;         ↓

Observation Parser

&#x20;         ↓

Observation Analysis

&#x20;         ↓

Developmental Grouping

&#x20;         ↓

Foundation Phase AI Prompt

&#x20;         ↓

Observation Reports

```



Grades 1–12 continue using the existing pipeline unchanged.



\---



\## Proposed Components



New parser:



\- observationParser.js



New services:



\- observationAnalysisService.js

\- observationGroupingService.js

\- observationWorkflowService.js



New prompt:



\- fullInterventionPlanFoundationPhase.js



New database tables:



\- observation\_assessments

\- observation\_records



No modifications are proposed to existing learner\_results,

item\_analysis or error\_analysis tables.



\---



\## Design Principles



\- Additive implementation only.

\- No breaking changes.

\- Preserve existing Grades 1–12 behaviour.

\- Reuse existing AI prompting patterns where appropriate.

\- Avoid retrofitting observation data into numeric models.



\---



\## Out of Scope



This document does not implement:



\- database migrations

\- webhook routing

\- observation parser

\- AI prompt generation

\- reporting



It documents the proposed architecture only.



\---



\## Future Work



1\. Observation database schema.

2\. Observation parser.

3\. Observation analysis service.

4\. Observation grouping.

5\. Foundation Phase intervention prompt.

6\. Observation reporting.

7\. Webhook integration.

8\. End-to-end testing.



\---



\## Current Status



Proposal only.



No production code depends on this document.

