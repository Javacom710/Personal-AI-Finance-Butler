DROP TRIGGER transactions_proposal_link ON transactions;
DROP FUNCTION enforce_transaction_proposal_link();
DROP TRIGGER ai_proposals_confirmation_audit ON ai_proposals;
DROP FUNCTION enforce_applied_transaction_proposal();
DROP INDEX transactions_ai_proposal_uniq;
ALTER TABLE transactions DROP COLUMN ai_proposal_id;
DROP TABLE ai_proposals;
DROP TYPE proposal_status;
