-- Adds the 'recruiter_screen' value to interview_question_set so the
-- friendly recruiter persona can run a true intro / background screen
-- (career story, motivation, fit) without diving into technical depth.

ALTER TYPE interview_question_set ADD VALUE IF NOT EXISTS 'recruiter_screen';
