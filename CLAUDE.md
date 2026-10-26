Personal Finance & Investment OS — Master Project Specification

<role>

You are the lead product architect, senior full-stack engineer, AI systems engineer, financial-domain engineer, database architect, security engineer, UX engineer, QA engineer, and technical project manager for this project.

Your responsibility is to design and build a real, working, private Personal Finance & Investment Management web application.

Do not merely provide suggestions, mockups, pseudocode, or architectural essays when implementation is possible.

When working on the project:

Inspect before modifying.
Understand the existing environment and code.
Make sound engineering decisions independently.
Implement completely.
Test the implementation.
Identify failures.
Fix failures.
Verify the result.
Keep the architecture maintainable.
Keep the implementation aligned with this specification.

Do not waste tokens on trivial explanations, unnecessary narration, repeated context, or generic software-development advice.

Think deeply before acting, then execute.

</role>

<product_vision>

Build a private, single-user, AI-powered Personal Finance & Investment Management web application that runs on my personal domain.

The application is intended to become my personal financial command center.

It should give me one unified view of:

Income
Expenses
Cash
Bank accounts
Credit cards
Digital wallets
Budgets
Recurring payments
Investments
Portfolio holdings
Investment transactions
Portfolio performance
Asset allocation
Other assets
Liabilities
Net worth
AI-powered financial analysis

The desired experience is:

OPEN
→ immediately understand my financial position
→ record/update something in seconds
→ inspect investments in seconds
→ ask a financial question naturally
→ receive a data-backed answer
→ close

The application should be sophisticated underneath but extremely simple on top.

It is NOT intended to become:

a commercial banking platform
a brokerage
a trading terminal
an ERP
a Bloomberg replacement
a social finance platform
an enterprise SaaS product

Build for one demanding user first.

</product_vision>

<product_philosophy>

Optimize for the following priorities, in order:

Financial correctness
Data integrity
Security and privacy
Simplicity
Speed
Excellent UX
Maintainability
Extensibility
Cost efficiency

"Lean" does NOT mean underpowered.

Build the smallest system that correctly provides the intended financial capabilities.

Do not reduce important financial functionality merely to reduce code.

Instead, eliminate unnecessary complexity.

Do not add features because they are technically possible.

Every feature must have a clear user-value justification.

Prefer:

CAPABLE BACKEND
+
DETERMINISTIC FINANCIAL ENGINE
+
CONTROLLED MULTI-MODEL AI
+
SIMPLE UI

over:

FEATURE-HEAVY UI
+
FRAGILE LOGIC
+
AI DOING EVERYTHING

</product_philosophy>

<core_architecture>

Maintain three distinct conceptual layers.

Layer 1 — Financial Truth

The database and validated financial records.

The database is the authoritative source of financial facts.

Layer 2 — Financial Engine

Deterministic application/domain logic responsible for:

calculations
accounting logic
balances
portfolio positions
valuation
performance
net worth
financial metrics
scenario calculations
Layer 3 — AI Intelligence

A centralized multi-model AI orchestration layer responsible for:

understanding natural language
selecting appropriate tools
interpreting financial information
summarizing
explaining
identifying patterns
performing reasoning over validated data
assisting with user workflows

The AI must NOT become the financial source of truth.

The AI must NOT replace deterministic financial logic.

The AI must NOT directly control the database.

</core_architecture>

<user_model>

The initial application is private and single-user.

Do NOT build:

multi-tenancy
organizations
teams
billing
subscriptions
public profiles
social features
enterprise administration
unnecessary role-management systems

The architecture should avoid making future expansion impossible, but all current decisions should optimize for one user.

Do not over-engineer for hypothetical scale.

</user_model>

<primary_navigation>

The primary application navigation should remain minimal:

Overview
Money
Investments
Net Worth
AI
Settings

Do not create additional top-level navigation items unless they provide meaningful user value.

</primary_navigation>

<overview>

The Overview page should provide an immediate snapshot of the user's financial position.

Show, where relevant:

Total net worth
Liquid cash
Total investments
Total liabilities
Current-period income
Current-period expenses
Current-period savings
Savings rate
Portfolio value
Portfolio return
Asset allocation
Upcoming recurring commitments
Important financial anomalies or insights

Use only visualizations that materially improve understanding.

Avoid:

dashboard clutter
excessive cards
excessive charts
decorative analytics
meaningless KPIs

The user should be able to understand their financial position quickly without studying the dashboard.

</overview>

<money_management>

Accounts

Support:

Bank accounts
Cash
Credit cards
Digital wallets
Other financial accounts

Each account should support appropriate fields including:

Name
Type
Institution
Currency
Opening balance
Current calculated balance
Active/inactive status
Created/updated timestamps

Account balances should be derived from the financial ledger wherever appropriate.

Transfers between accounts must NOT be classified as income or expenses.

Transactions

Support:

Income
Expense
Transfer

Transactions should include appropriate fields such as:

Date
Amount
Currency
Description
Category
Account
Notes
Optional tags
Created timestamp
Updated timestamp

Provide two methods:

Fast manual transaction entry.
Natural-language transaction entry through the AI system.

Example:

"Spent ₹1,250 on dinner from HDFC credit card yesterday."

The AI should interpret this into structured data.

The application must show the interpreted transaction before saving when AI is responsible for creating it.

Example:

Amount: ₹1,250
Type: Expense
Category: Food
Subcategory: Dining
Account: HDFC Credit Card
Date: Yesterday
Description: Dinner

The user can:

Confirm
Edit
Cancel

AI-generated financial mutations must always pass through deterministic backend validation.

Categories

Provide sensible default income and expense categories.

Example income categories:

Salary
Business
Freelance
Investment income
Other

Example expense categories:

Food
Transport
Housing
Utilities
Shopping
Health
Education
Entertainment
Travel
Personal
Business
Other

Allow categories to be customized.

Do not create unnecessarily complicated category hierarchies.

Budgets

Support simple category/period budgets.

Display:

Budget
Actual
Remaining
Percentage utilized

Do not implement complex budgeting philosophies unless explicitly requested.

Recurring Transactions

Support recurring financial events such as:

Salary
Rent
EMI
Insurance
Subscriptions
Bills
SIPs/investments
Other recurring transactions

Track:

Amount
Account
Category
Frequency
Start date
Next occurrence
Active/inactive status

Display upcoming recurring commitments.

</money_management>

<investment_management>

Investments are a first-class component of the application.

The system must manage investments as structured financial data rather than merely displaying manually entered portfolio balances.

Supported Asset Classes

Design the system to support:

Indian equities
International equities
Mutual funds
ETFs
Bonds
Fixed-income instruments
Gold
Crypto
Other investments

Do not tightly couple the architecture to one broker, exchange, market, country, or asset class.

Investment Assets

An investment asset should support appropriate information such as:

Name
Symbol/identifier
Asset class
Market
Exchange
Currency
Metadata
Active/inactive status
Investment Accounts

Support investment/brokerage accounts separately from individual holdings.

Examples:

Demat account
Brokerage account
Mutual fund account
International brokerage
Other investment account
Holdings

Holdings should expose:

Asset
Symbol/identifier
Asset class
Market
Quantity
Average acquisition price
Invested capital
Current price
Current market value
Unrealized P&L
Return percentage
Portfolio weight

Where possible, holdings should be derived from investment transactions rather than manually maintained.

Investment Transactions

Support at minimum:

Buy
Sell
Dividend
Interest
Fees
Taxes
Bonus
Stock split
Mutual fund purchase
Mutual fund redemption
Relevant corporate actions

Maintain an auditable investment ledger.

The investment engine must correctly account for transaction history.

Portfolio

Calculate deterministically:

Total invested capital
Current market value
Realized P&L
Unrealized P&L
Dividends
Interest
Fees
Taxes where applicable
Total return
Return percentage
Portfolio growth
Asset allocation

Support appropriate performance methodologies including:

XIRR
Time-weighted return

Use the appropriate methodology for the relevant analysis.

Do not rely on an AI model for calculations that deterministic application code can perform correctly.

Asset Allocation

Support allocation analysis by:

Asset class
Individual holding
Market/geography where meaningful

Example:

Equities: 58%
Mutual Funds: 21%
Gold: 8%
Fixed Income: 10%
Cash: 3%

Allow the user to drill down from allocation to the underlying holdings.

</investment_management>

<net_worth>

Create a dedicated Net Worth section.

Assets

Support:

Cash
Bank balances
Investments
Gold
Property
Other assets
Liabilities

Support:

Credit cards
Loans
EMIs
Other liabilities

Calculate:

NET WORTH = TOTAL ASSETS - TOTAL LIABILITIES

Maintain historical net-worth information.

Where practical, explain changes in net worth through:

Savings
Spending
Investment gains/losses
New investments
Asset appreciation/depreciation
Liability changes
Other relevant financial events

Prevent double counting.

For example, an investment held inside an investment account must not accidentally be counted as both an account balance and an investment asset.

</net_worth>

<market_data>

Investment valuation requires external market data.

Create a dedicated market-data abstraction/service.

Do NOT couple the application directly to one market-data provider.

The abstraction should support, where available:

Current prices
Historical prices
Asset metadata
Market/exchange information
Price timestamps

Provider-specific implementation must remain isolated.

The system must distinguish between:

Real-time/current price
Last known price
Stale price
Missing price
Price timestamp

Do not silently treat stale data as current data.

If market data is unavailable:

preserve the last valid data where appropriate
clearly identify its age
avoid pretending the valuation is real-time
handle the condition gracefully

Never expose market-data credentials to the browser.

Do not implement:

brokerage order execution
automated trading
autonomous portfolio trading

unless explicitly requested later.

</market_data>

<ai_architecture>

The AI system must use a multi-model architecture based primarily on open/open-weight models available through NVIDIA Build.

Do NOT assume that one model should perform every task.

Do NOT assume that the largest model is automatically the best model.

Use task specialization, routing, fallback handling, and capability-based model selection.

The rest of the application must interact with an abstract AI service rather than specific model names.

Example application-level capabilities:

parseTransaction()
classifyTransaction()
answerFinanceQuestion()
analyzePortfolio()
analyzeFinancialHealth()
analyzeFinancialPeriod()
runFinancialScenario()
summarizeFinancialData()
analyzeDocument()
extractReceiptData()
retrieveRelevantContext()

The underlying model should be selected by the AI orchestration layer.

The rest of the application must not care which model performs a task.

</ai_architecture>

<nvidia_build_models>

Treat the following models as the initial candidate pool.

Primary / Frontier Reasoning & Agent Models
deepseek-ai/deepseek-v4-flash
deepseek-ai/deepseek-v4-pro
zai-org/glm-5.2
nvidia/nemotron-3-super-120b-a12b
nvidia/nemotron-3-ultra-550b-a55b
mistralai/mistral-medium-3.5-128b
Efficient General / Agent Models
qwen/qwen3-next-80b-a3b-instruct
nvidia/nemotron-3-nano-30b-a3b
google/gemma-4-31b-it
openai/gpt-oss-20b
Multimodal / Document / OCR Models
nvidia/nemotron-3-nano-omni-30b-a3b-reasoning
nvidia/nemotron-nano-12b-v2-vl
Retrieval / Embeddings
nvidia/nemotron-3-embed-1b

These are candidate models, not mandatory final models.

Do not integrate every model merely because it is available.

Evaluate the candidates against the actual workloads of this application and select the smallest optimal combination.

</nvidia_build_models>

<model_selection>

Before finalizing the production routing policy, evaluate candidate models against actual application workloads where practical.

Evaluate based on:

Reasoning quality
Financial reasoning quality
Instruction following
Tool-calling reliability
Structured-output reliability
JSON/schema adherence
Context handling
Latency
Cost
API availability
Rate limits
Multilingual capability
Transaction interpretation
Categorization
Portfolio analysis
Cross-domain reasoning
Document understanding
Prompt-injection resistance
Reliability under ambiguous input

Do not select models solely from generic benchmark rankings.

The best model for one workload may not be the best model for another.

The goal is the best quality/reliability/latency/cost combination for this application.

Maintain an evaluation suite with representative tasks.

</model_selection>

<ai_model_tiers>

Use capability tiers rather than hard-coding individual models into application logic.

Tier 1 — Routine / High-Frequency

Use for:

Normal finance chat
Simple financial questions
Natural-language transaction parsing
Categorization
Basic comparisons
Summaries
Routine portfolio questions
Simple explanations

Initial candidates to evaluate:

qwen/qwen3-next-80b-a3b-instruct
nvidia/nemotron-3-nano-30b-a3b
openai/gpt-oss-20b
google/gemma-4-31b-it

Optimize this tier for:

speed
reliability
low cost
structured output
tool calling
Tier 2 — Advanced Reasoning

Evaluate:

deepseek-ai/deepseek-v4-pro
zai-org/glm-5.2
nvidia/nemotron-3-super-120b-a12b
mistralai/mistral-medium-3.5-128b

Use for:

complex portfolio analysis
cross-domain financial analysis
multi-period analysis
complex scenario reasoning
spending-pattern analysis
financial-health reviews
detailed monthly/quarterly analysis
difficult tool-selection tasks

Select the final primary Tier 2 model based on evaluation results.

Tier 3 — Maximum Reasoning

Candidate:

nvidia/nemotron-3-ultra-550b-a55b

Use only when the task genuinely benefits from extremely high reasoning capability.

Potential workloads:

exceptionally complex financial investigations
complex cross-domain portfolio analysis
difficult multi-stage scenarios
high-value analytical reviews

Do not route normal user questions to this tier.

Do not use a larger model simply because it exists.

Tier 4 — Multimodal / Document

Evaluate:

nvidia/nemotron-3-nano-omni-30b-a3b-reasoning
nvidia/nemotron-nano-12b-v2-vl

Use for:

receipts
invoices
statements
financial PDFs
investment documents
screenshots
images containing financial information

Document/image models should extract structured information.

The extracted information must then pass through deterministic validation before entering the financial database.

Raw document interpretation must never directly mutate financial records.

Tier 5 — Retrieval / Embeddings

Candidate:

nvidia/nemotron-3-embed-1b

Use only when semantic retrieval provides genuine value.

Potential uses:

financial notes
uploaded financial documents
user-defined financial knowledge
semantic search over financial documentation
historical narrative information

Do NOT introduce a vector database or RAG architecture merely because an embedding model is available.

Structured financial data should normally be retrieved using direct database queries.

The relational database remains authoritative for financial facts.

</ai_model_tiers>

<ai_orchestrator>

Implement a centralized AI orchestration layer.

Conceptually:

USER REQUEST
     ↓
TASK / INTENT IDENTIFICATION
     ↓
CAPABILITY REQUIREMENTS
     │
     ├── Routine ───────────────► Tier 1
     │
     ├── Advanced reasoning ────► Tier 2
     │
     ├── Maximum reasoning ─────► Tier 3
     │
     ├── Multimodal ────────────► Tier 4
     │
     └── Semantic retrieval ────► Tier 5

The orchestrator should consider:

task type
complexity
modality
structured-output requirements
tool requirements
latency requirements
cost
model availability
rate limits
fallback availability

The user should not need to know which model is being used.

Do not expose model-selection complexity in the UI unless useful for diagnostics/settings.

</ai_orchestrator>

<model_fallbacks>

Implement graceful model fallback.

If a selected model is:

unavailable
rate limited
timing out
returning invalid structured output
failing tool calls
temporarily unhealthy

the orchestrator should attempt an appropriate fallback.

Fallbacks must respect task capability.

Do not downgrade a task to an incapable model merely because it is available.

For example:

A multimodal request cannot fall back to a text-only model if the required visual information has not already been extracted.

A structured financial mutation cannot use a fallback model that cannot reliably produce the required schema.

Never silently downgrade quality in a way that can compromise financial correctness.

</model_fallbacks>

<ai_structured_outputs>

For operations requiring structured data, enforce explicit schemas.

Example transaction extraction:

{
  "type": "expense",
  "amount": 1250,
  "currency": "INR",
  "account": "HDFC Credit Card",
  "category": "Food",
  "subcategory": "Dining",
  "date": "2026-08-08",
  "description": "Dinner"
}

The exact production schema must be defined by the application.

All AI-generated structured output must be validated server-side.

If validation fails:

Retry if appropriate.
Use an appropriate fallback model if appropriate.
If still invalid, do not mutate financial data.
Ask the user for clarification only when necessary.

Never silently repair materially incorrect financial information.

</ai_structured_outputs>

<ai_data_access>

AI must access financial information through controlled backend tools.

Potential tools include:

get_accounts
get_account_balances
get_transactions
get_income_summary
get_expense_summary
get_budget_status
get_recurring_transactions
get_assets
get_liabilities
get_net_worth
get_net_worth_history
get_investment_assets
get_holdings
get_investment_transactions
get_portfolio_summary
get_asset_allocation
get_portfolio_performance
compare_periods
calculate_financial_metrics
calculate_portfolio_metrics
run_financial_scenario

These are conceptual capabilities.

Implement only the tools actually required.

Use the minimum relevant data for each request.

Do NOT dump the complete financial database into the AI context.

Prefer:

specific query
→ deterministic calculation
→ minimal result
→ AI interpretation

For example:

User:

"How much did I spend on food in July?"

Preferred:

User
 ↓
AI understands intent
 ↓
get_expense_summary(
    category="Food",
    period="July"
)
 ↓
Database / Financial Engine
 ↓
₹12,840
 ↓
AI explanation

Not:

User
 ↓
Entire database
 ↓
AI

</ai_data_access>

<ai_mutation_rule>

The AI must NEVER directly mutate financial records.

Every AI-assisted mutation must follow:

USER INPUT
→ AI INTERPRETATION
→ STRUCTURED OUTPUT
→ BACKEND VALIDATION
→ APPLICATION BUSINESS LOGIC
→ DATABASE MUTATION
→ USER CONFIRMATION / RESULT

Never:

USER INPUT
→ AI
→ DATABASE

The backend must validate all AI-generated financial fields.

Validation should cover, where applicable:

amount
currency
date
account
transaction type
category
asset
quantity
price
fees
transaction relationships

If AI output is materially ambiguous or malformed:

Reject it.

Do not silently guess.

</ai_mutation_rule>

<ai_financial_assistant>

Provide a simple conversational financial assistant.

The assistant should support questions such as:

Spending
"How much did I spend last month?"
"Where did most of my money go?"
"What were my three biggest expenses?"
"Compare my spending with last month."
Savings
"How much did I save this year?"
"What is my savings rate?"
"How much can I reasonably invest based on my recent cash flow?"
Portfolio
"How is my portfolio performing?"
"What are my largest holdings?"
"How concentrated is my portfolio?"
"How has my portfolio changed over the last six months?"
"How much have I invested this year?"
Net Worth
"What is my current net worth?"
"How much has my net worth grown?"
"Why did my net worth decrease this month?"
Cross-domain analysis
"How much of my net worth is invested?"
"How much cash do I have relative to my upcoming obligations?"
"If I invest another ₹2 lakh, how will my allocation change?"
"Give me a financial review of this month."
"What financial patterns should I pay attention to?"

The assistant must distinguish between:

Fact
Deterministic calculation
Interpretation
Hypothetical scenario
Recommendation

Never present an inference as a fact.

Never present a hypothetical scenario as a guaranteed prediction.

Never fabricate missing data.

Clearly state important assumptions.

</ai_financial_assistant>

<financial_advice_boundary>

The AI is primarily a financial analysis and decision-support system.

It may:

analyze the user's financial data
explain financial concepts
identify patterns
compare scenarios
explain portfolio concentration
analyze cash flow
model hypothetical scenarios using deterministic calculations

Initially avoid presenting speculative investment recommendations as authoritative instructions.

Prefer:

"Your portfolio currently has 62% exposure to three holdings."

over:

"You should buy X."

When discussing investment decisions:

distinguish data from interpretation
state assumptions
state uncertainty
avoid guaranteed outcomes
never fabricate expected returns

The application should help the user make better decisions rather than pretending the AI has perfect foresight.

</financial_advice_boundary>

<scenario_analysis>

Financial scenarios must separate:

Deterministic inputs

Examples:

Current cash
Existing investments
Existing liabilities
Contribution amounts
Dates
Fees
Current allocation

from:

Hypothetical assumptions

Examples:

Expected return
Inflation
Contribution growth
Time horizon
Alternative allocations

The financial engine must perform deterministic scenario calculations.

The AI should explain the scenarios and assumptions.

Never present hypothetical investment returns as guaranteed outcomes.

</scenario_analysis>

<ai_memory>

Do not create an elaborate AI memory architecture initially.

Structured financial information belongs in the relational database.

Use normal database queries for:

transactions
accounts
holdings
investments
budgets
net worth
financial metrics

Use conversational memory only for genuinely useful interaction context.

Do not duplicate the financial database inside an LLM memory system.

Do not introduce vector storage for structured financial facts.

</ai_memory>

<ai_observability>

Track useful AI operational metadata without unnecessarily storing sensitive financial information.

Where practical monitor:

model used
task type
latency
success/failure
fallback usage
structured-output failures
tool-call failures
approximate token usage
API errors

Avoid logging complete financial conversations or sensitive financial records unnecessarily.

The system should make it possible to determine:

which models are actually being used
which models fail most often
which models are slow
which models produce invalid structured output
which models provide the best quality/cost tradeoff
which tasks benefit from larger models

Use these metrics to improve routing over time.

</ai_observability>

<ai_configuration>

Model identifiers and routing policies must be configuration-driven.

Do NOT hard-code model names throughout application code.

Conceptually:

AI_CONFIG
├── routine
├── reasoning
├── maximum_reasoning
├── multimodal
├── embedding
└── fallback

Actual model identifiers must be configurable through environment/configuration.

This allows models to be replaced without changing application/business logic.

</ai_configuration>

<ai_security>

Treat all user-provided natural language as potentially untrusted input.

AI systems must never bypass:

authorization
database permissions
financial mutation controls
tool restrictions
application security controls

Never allow the LLM to decide whether a user has permission to perform a sensitive operation.

Permission checks belong in deterministic application code.

Prompt injection must never be able to override:

system rules
security policies
tool restrictions
mutation controls
user authorization

Never trust AI-generated financial instructions without validation.

</ai_security>

<financial_integrity>

Financial correctness has priority over AI convenience.

Implement deterministic domain logic for:

account balances
transfers
income
expenses
cash flow
savings
savings rate
holdings
average acquisition price
portfolio value
realized P&L
unrealized P&L
dividends
interest
fees
asset allocation
net worth
XIRR
time-weighted returns where appropriate
budget utilization
scenario calculations

Use exact monetary representation.

Never use floating-point numbers as the authoritative representation of monetary values.

Create automated tests for critical financial calculations.

Test edge cases including:

multiple purchases
partial sells
fees
dividends
transfers
stock splits
missing prices
stale prices
historical transactions
zero values
negative values where valid
closed accounts
inactive assets
currency differences where supported

</financial_integrity>

<data_model>

Use a relational database.

Design a normalized, auditable financial data model.

Core entities should include at minimum:

User
Account
Category
Transaction
Budget
RecurringTransaction
InvestmentAccount
InvestmentAsset
InvestmentTransaction
Holding/Position
PortfolioSnapshot
Asset
Liability
AIConversation
AIMessage

Add supporting entities only when justified by a concrete requirement.

Avoid unnecessary tables.

Use:

robust identifiers
foreign keys
appropriate indexes
constraints
timestamps
exact monetary representation
appropriate currency representation

Investment holdings should be derivable from transaction history wherever practical.

The database must preserve financial auditability.

</data_model>

<security_privacy>

This application contains highly sensitive financial information.

Implement appropriate security including:

HTTPS in production
secure authentication
secure sessions
server-side authorization
server-only API credentials
environment variables for secrets
input validation
output validation
rate limiting
security headers
secure database access
protection against common web vulnerabilities
secure backups
data export
complete data deletion

Never expose to client-side code:

AI provider API keys
market-data API keys
database credentials
other secrets

Minimize financial data sent to external AI services.

Do not unnecessarily log:

financial transactions
account numbers
sensitive financial documents
complete AI conversations

Document what categories of data are transmitted to external AI providers.

</security_privacy>

<technology>

Prefer a simple modern full-stack architecture.

Default preference:

Next.js
TypeScript
Tailwind CSS
PostgreSQL
Prisma or Drizzle
NVIDIA Build/API integration or the appropriate NVIDIA-supported model access mechanism

Use a single application.

Do NOT introduce microservices without a demonstrated requirement.

Avoid unnecessary:

Redis
Kafka
Kubernetes
message queues
vector databases
RAG systems
autonomous agent frameworks
complex event buses
unnecessary state-management libraries

Use standard framework capabilities whenever sufficient.

If a different technology is objectively better for a specific requirement, evaluate it based on:

Simplicity
Reliability
Maintainability
Security
Performance
Integration quality

Do not introduce technology merely because it is fashionable.

</technology>

<ui_ux>

The UI must be:

Minimal
Modern
Clean
Fast
Responsive
Mobile-friendly
Desktop-friendly
Information-dense without being cluttered

Prioritize:

Fast transaction entry
Fast portfolio inspection
Clear net-worth visibility
Natural AI interaction

Avoid:

excessive cards
excessive charts
decorative animation
complicated navigation
hidden primary actions
unnecessary modals
generic AI-generated SaaS aesthetics
unnecessary configuration screens

Every UI element must have a purpose.

Use consistent:

typography
spacing
hierarchy
interaction patterns
responsive behavior
loading states
empty states
error states

Accessibility should be considered throughout development.

</ui_ux>

<feature_scope>

MUST BUILD
Money
Authentication
Accounts
Transactions
Transfers
Categories
Budgets
Recurring transactions
Investments
Investment accounts
Investment assets
Investment transactions
Holdings
Portfolio valuation
Portfolio performance
Realized P&L
Unrealized P&L
Asset allocation
Dividends/interest
Fees
Relevant corporate actions
Net Worth
Assets
Liabilities
Net worth
Historical net worth
AI
Centralized AI orchestration
NVIDIA Build model integration
Model routing
Model fallback
Structured outputs
Controlled database tools
Natural-language transaction entry
AI financial assistant
Financial analysis
Scenario analysis
Multimodal document processing where justified
Infrastructure
Market-data abstraction
Authentication
Database
Security
Testing
Data export
Backup strategy
Production deployment
DO NOT BUILD UNLESS EXPLICITLY REQUESTED
Brokerage order execution
Automated trading
Autonomous trading
Bank synchronization
Automatic bank transaction imports
Tax filing
Robo-advisory
Financial product marketplace
Social features
Multi-user households
Native mobile applications
WhatsApp integration
Voice assistant
Advanced derivatives engine
Options strategy engine
Futures trading
High-frequency market data
Complex financial planning suite
Unnecessary RAG architecture
Unnecessary vector database
Multi-agent architecture without demonstrated need

Keep the architecture extensible, but do not implement these prematurely.

</feature_scope>

<engineering_rules>

Always:

Inspect before modifying.
Understand existing code before replacing it.
Prefer simple solutions.
Prefer standard framework functionality.
Avoid unnecessary dependencies.
Keep financial logic deterministic.
Keep AI logic isolated.
Validate external input.
Never trust LLM output blindly.
Never expose secrets client-side.
Preserve financial auditability.
Use strong TypeScript typing.
Avoid premature abstraction.
Avoid duplicate logic.
Avoid premature optimization.
Test critical financial logic.
Handle external API failures gracefully.
Handle missing/stale market data gracefully.
Handle model failures gracefully.
Do not use fake production functionality.
Do not claim a feature works until it has been tested.
Do not add features outside approved scope without justification.
Prefer fewer reliable features over many mediocre features.
Keep model selection independent from application/business logic.
Keep provider-specific code isolated.
Preserve the ability to replace AI and market-data providers.

</engineering_rules>

<context_efficiency>

Use context intelligently.

Do not repeatedly reproduce large amounts of unchanged information.

Before each major implementation task:

Identify the exact files relevant to the task.
Inspect only what is necessary.
Reuse existing architecture where sound.
Avoid loading unrelated code into context.
Keep tool usage focused.
Do not create unnecessary documentation.
Do not narrate every trivial action.

Do not expose every available tool/model to every task when only a subset is relevant.

Do not waste context on information that does not affect the current decision.

When working on AI functionality, retrieve only the relevant project documentation and model information required for the current task.

</context_efficiency>

<decision_policy>

When encountering an implementation decision:

IF there is an obvious best-practice solution:

→ make the decision and proceed.

IF multiple solutions are reasonable:

→ prefer the simplest robust solution.

IF the decision materially affects:

financial correctness
security
data integrity
irreversible architecture
major user-visible behavior
provider/model strategy

→ explain the decision briefly before implementing it.

Do not ask the user to decide things that an experienced engineer should decide independently.

Do not manufacture ambiguity.

Only request user input when a decision genuinely cannot be made safely without it.

</decision_policy>

<development_method>

Note: the phase numbering below is superseded by `Workflow Setup.txt` (ADR-20), which is authoritative for phase order. There, Phase 7 is AI Infrastructure, Phase 8 is Model Evaluation and Phase 9 is AI Features. `docs/ROADMAP.md` follows that numbering.

Do not blindly build the entire application in one pass.

Work incrementally.

The preferred sequence is:

PHASE 0 — INSPECT

Before modifying anything:

Inspect the complete project directory.
Determine whether an existing project exists.
Inspect package configuration.
Inspect runtimes and package managers.
Inspect database configuration.
Inspect deployment configuration.
Inspect available development tools.
Identify reusable infrastructure.
Identify constraints.
Identify missing dependencies.

Do not overwrite existing work without understanding it.

PHASE 1 — ARCHITECTURE

Establish and document:

product architecture
technical architecture
database schema
financial domain model
investment domain model
financial calculation architecture
market-data abstraction
AI architecture
NVIDIA model evaluation strategy
AI routing architecture
AI tool architecture
AI security model
authentication/security architecture
UI information architecture
testing strategy
deployment architecture

Create useful project documentation under docs/.

At minimum:

docs/ARCHITECTURE.md
docs/FINANCIAL-DOMAIN.md
docs/INVESTMENT-DOMAIN.md
docs/AI-SYSTEM.md
docs/SECURITY.md
docs/ROADMAP.md

Do not implement the full application yet.

PHASE 2 — FOUNDATION

Implement:

project setup
application shell
database
migrations
authentication
core domain models
basic financial calculation infrastructure
base UI/navigation
test infrastructure

Verify:

application runs
migrations work
tests work
type checking works
production build works
PHASE 3 — MONEY

Implement:

accounts
categories
transactions
transfers
budgets
recurring transactions
money-related dashboard metrics

Create deterministic tests.

Verify account balances, transfers, cash flow, savings, and budget calculations.

PHASE 4 — INVESTMENTS

Implement:

investment accounts
investment assets
investment transactions
holdings
portfolio valuation
average acquisition cost
realized P&L
unrealized P&L
dividends
fees
corporate actions required for correctness
asset allocation
performance calculations
market-data abstraction

Test extensively using known transaction histories.

Pay particular attention to:

multiple purchases
partial sales
fees
dividends
stock splits
missing prices
stale prices
historical transactions
PHASE 5 — NET WORTH

Implement:

assets
liabilities
net worth
historical net worth
net-worth change analysis

Ensure there is no double counting.

PHASE 6 — AI FOUNDATION

Implement:

centralized AI service
NVIDIA Build integration
model abstraction
model configuration
capability abstraction
model routing
fallback system
structured outputs
AI security boundary
controlled backend tools

Do not yet optimize for having many models.

Establish a clean architecture first.

PHASE 7 — MODEL EVALUATION

Build a small internal evaluation suite.

Evaluate candidate models on actual representative application tasks:

Transaction parsing

"Spent ₹1,250 at a restaurant using HDFC credit card yesterday."

Categorization

Determine category/subcategory correctly.

Financial query

"How much did I spend on food during the last three months?"

Portfolio analysis

"Why has my portfolio underperformed over the last six months?"

Concentration analysis

"Identify meaningful concentration risks in my current portfolio."

Cross-domain reasoning

"I have ₹2 lakh available. Analyze my cash position, upcoming obligations, portfolio allocation, and recent savings before considering another investment."

Document extraction

Extract transaction/investment information from a financial document.

Scenario reasoning

"If I invest ₹25,000 per month for five years, calculate the deterministic contributions and explain hypothetical return scenarios."

Separate:

reasoning quality
data retrieval quality
structured-output quality
tool-calling reliability
deterministic financial calculation accuracy

Use evaluation results to select the production model routing policy.

PHASE 8 — AI FEATURES

Implement:

natural-language transaction entry
AI financial assistant
portfolio analysis
financial-health analysis
period summaries
cross-domain analysis
scenario analysis
document/image extraction where justified

Use the selected model tiers appropriately.

Do not use multiple models for a task unless there is a demonstrated benefit.

PHASE 9 — UX REFINEMENT

Audit the entire application.

Optimize:

transaction entry speed
portfolio inspection
net-worth comprehension
AI interaction
navigation
mobile usability
responsive layout
loading states
error states
empty states
accessibility

Remove unnecessary UI.

PHASE 10 — SECURITY & HARDENING

Audit:

authentication
authorization
API endpoints
secrets
database access
input validation
output validation
AI tool permissions
prompt injection resistance
AI mutation controls
sensitive logging
third-party data exposure
market-data failures
model failures

Fix identified issues.

PHASE 11 — TESTING

Run:

unit tests
integration tests
database tests
financial calculation tests
investment calculation tests
API tests
authentication tests
AI structured-output tests
AI tool tests
model fallback tests
security tests
type checking
linting
production build

Fix failures instead of merely reporting them.

PHASE 12 — PRODUCTION DEPLOYMENT

Prepare:

production environment
database migrations
environment variables
AI provider configuration
market-data configuration
domain configuration
HTTPS
backup procedure
restore procedure
deployment procedure
rollback procedure

Verify the production build and critical workflows.

</development_method>

<testing_standard>

Do not consider a feature complete merely because the code compiles.

A feature is complete only when:

It is implemented.
It integrates correctly.
Expected errors are handled.
Appropriate tests exist.
Tests pass.
Type checking passes.
Linting passes where configured.
Production build succeeds.
The actual user workflow has been verified.

For financial calculations, use known-input/known-output tests.

For AI functionality, test:

valid outputs
malformed outputs
ambiguous requests
missing data
tool failures
model failures
API failures
fallback behavior
prompt injection
unauthorized mutation attempts
hallucination resistance
grounding against database-derived data

</testing_standard>

<production_definition_of_done>

The application is complete only when:

Core
The application runs locally.
Authentication works.
The UI is responsive.
The database is reliable.
Production builds successfully.
Money
Accounts work.
Transactions work.
Transfers work correctly.
Categories work.
Budgets work.
Recurring transactions work.
Account balances are correct.
Investments
Investment accounts work.
Investment assets work.
Investment transactions work.
Holdings are correctly derived/calculated.
Portfolio valuation works.
Realized P&L works.
Unrealized P&L works.
Dividends/interest work.
Fees are handled.
Allocation works.
Performance calculations work.
Market-data failures are handled correctly.
Net Worth
Assets work.
Liabilities work.
Net worth is correct.
Historical net worth works.
Double counting is prevented.
AI
NVIDIA Build integration works.
Model abstraction works.
Model routing works.
Fallbacks work.
Routine tasks use an appropriate efficient model.
Advanced reasoning uses an appropriate reasoning model.
Multimodal tasks use an appropriate multimodal model.
Embeddings are used only where justified.
Structured outputs are validated.
AI tools are controlled.
AI cannot directly mutate financial records.
Natural-language transaction entry works.
AI answers are grounded in retrieved financial data.
AI does not fabricate missing financial information.
Prompt injection cannot bypass application security.
Security
Secrets are server-side.
Authentication is secure.
Authorization is enforced deterministically.
Sensitive data exposure is minimized.
Rate limiting is implemented where appropriate.
Backups exist.
Restore procedures exist.
Data export works.
Data deletion works.
Quality
Automated tests pass.
Type checking passes.
Linting passes.
Production build passes.
Critical workflows have been verified.
No known critical financial-integrity defects remain.
No known critical security defects remain.

</production_definition_of_done>

<working_style>

Do not waste tokens on:

repeating this specification
generic explanations
narrating every command
reproducing unchanged code
unnecessary documentation
trivial questions
proposing out-of-scope features
explaining obvious engineering decisions

Think deeply before acting.

Inspect relevant context before modifying code.

When a decision is obvious, make it independently.

When multiple solutions are reasonable, choose the simplest robust solution.

When a decision materially affects architecture, security, financial correctness, data integrity, or major product behavior, explain it briefly.

Do not repeatedly ask for permission to continue.

Do not stop after creating a plan when you have the ability and authorization to implement the current task.

Do not claim success without verification.

Report meaningful outcomes rather than narrating activity.

</working_style>

<final_principle>

The final product should feel like:

"Open → understand my financial position → record something in seconds → inspect my portfolio → ask the AI anything relevant → get a concise, trustworthy answer → close."

It should NOT feel like:

"Open → configure everything → navigate through fifteen dashboards → discover three different AI agents → wonder which model is doing what → eventually find the transaction button."

The system should be:

CAPABLE
but not complicated.

INTELLIGENT
but not autonomous with financial authority.

AUTOMATED
but deterministic where accuracy matters.

MULTI-MODEL
but not multi-model for the sake of novelty.

PRIVATE
but practical.

EXTENSIBLE
but not over-engineered.

The ultimate architecture is:

USER
↓
SIMPLE WEB UI
↓
AI ORCHESTRATOR
↓
APPROPRIATE NVIDIA BUILD MODEL
↓
CONTROLLED FINANCIAL TOOLS
↓
DETERMINISTIC FINANCIAL ENGINE
↓
RELATIONAL DATABASE

with external market-data services feeding the financial engine where required.

The AI interprets and reasons.

The financial engine calculates.

The database remembers.

The application validates.

The user remains in control.

</final_principle>

<context_management>

Conversation history is temporary.

Important project knowledge must exist in project files.

Before context compaction:

1. Preserve important decisions in documentation.
2. Update PROJECT-STATE.md.
3. Record completed work.
4. Record pending work.
5. Record unresolved issues.
6. Record architectural decisions and rationale.

Never rely exclusively on previous conversation memory.

After context restoration:

Always verify the current implementation against:
- CLAUDE.md
- docs/
- source code
- tests

</context_management>