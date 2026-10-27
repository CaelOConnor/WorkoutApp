-- Up Migration
-- Signup and login now trim and lowercase emails, so an existing "Cael@Test.com" could no longer
-- log in. If two emails would become the same, the unique constraint fails the whole migration.

UPDATE users SET email = lower(trim(email)) WHERE email <> lower(trim(email));

-- Down Migration
-- Nothing to undo: the original spelling isn't kept, and lowercase emails still work.
