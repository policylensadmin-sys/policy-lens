# Requirements Document

## Introduction

PolicyLens is an AI-powered Insurance Intelligence Platform that transforms complex insurance policy documents into clear, personalized guidance. The platform serves individual policyholders, insurance brokers, and corporate employers through three distinct portals. Phase 1 focuses on the Customer Portal (consumer AI app), Broker CMS Portal, and the core AI engine (OCR + Analysis + Chat).

Tagline: "Understand your insurance before you need it."

## Glossary

- **PolicyLens**: The AI-powered Insurance Intelligence Platform comprising three portals
- **Customer_Portal**: The individual/family-facing portal for uploading, analyzing, and managing insurance policies
- **Broker_Portal**: The CRM/CMS portal for insurance brokers to manage clients, policies, renewals, and commissions
- **Corporate_Portal**: The employer-facing portal for managing employee group insurance (Phase 2)
- **AI_Engine**: The core processing pipeline that performs OCR extraction, AI analysis, embedding generation, and natural language chat
- **OCR_Service**: The optical character recognition service (Google Vision) that extracts text from scanned policy documents and images
- **Policy_Parser**: The component that extracts structured data from policy text (searchable PDFs via pdf-parse, scanned documents via OCR_Service)
- **Health_Score**: A numerical rating (0-100) reflecting overall policy quality based on coverage breadth, waiting periods, exclusions, restrictions, co-pay levels, and claim friendliness
- **Policy_Vault**: The secure storage area where users organize and manage multiple insurance policies by category
- **Claim_Simulator**: The feature that evaluates a user-described scenario against policy terms to estimate claim approval probability
- **Vector_Store**: The pgvector-based database storing policy chunk embeddings for semantic search and AI-grounded responses
- **Policy_Chunk**: A discrete section of a policy document that is individually embedded for semantic retrieval
- **Background_Processor**: The async job system that handles long-running tasks (OCR, AI analysis) with progress updates
- **Coverage_Gap**: An area where a client lacks adequate insurance protection, identified by AI analysis
- **Renewal_Calendar**: The broker tool displaying upcoming policy renewal dates and amounts
- **Premium_Tracker**: The broker tool for monitoring premium collection status with charts and breakdowns

## Requirements

### Requirement 1: Policy Document Upload

**User Story:** As an individual policyholder, I want to upload my insurance policy documents, so that I can have them analyzed by AI without manual data entry.

#### Acceptance Criteria

1. WHEN a user uploads a PDF file, THE Customer_Portal SHALL accept the file and initiate background processing
2. WHEN a user uploads an image file (JPEG, PNG), THE Customer_Portal SHALL accept the file and initiate background processing
3. WHEN a user captures a document via camera scan, THE Customer_Portal SHALL accept the captured image and initiate background processing
4. IF a user uploads a file that is not a supported format (PDF, JPEG, PNG), THEN THE Customer_Portal SHALL display an error message specifying the supported formats
5. IF a user uploads a file exceeding 20 MB, THEN THE Customer_Portal SHALL display an error message indicating the 20 MB size limit
6. WHILE the Background_Processor is processing an uploaded document, THE Customer_Portal SHALL display a progress indicator showing the current processing stage (Upload → OCR → Analysis → Done)
7. IF the Background_Processor fails to complete processing of an uploaded document, THEN THE Customer_Portal SHALL display an error message indicating the failure reason and provide an option to retry the upload
8. IF the Background_Processor does not complete processing within 120 seconds, THEN THE Customer_Portal SHALL display a timeout error message and provide an option to retry the upload

### Requirement 2: OCR Text Extraction

**User Story:** As an individual policyholder, I want my scanned policy documents to be converted to searchable text, so that the AI can analyze the content regardless of document format.

#### Acceptance Criteria

1. WHEN a PDF is uploaded, THE Policy_Parser SHALL detect whether the PDF contains embedded selectable text and, if it does, extract text directly using pdf-parse without invoking OCR_Service
2. WHEN a PDF contains no embedded selectable text or an image file (JPEG, PNG) is uploaded, THE Policy_Parser SHALL invoke OCR_Service (Google Vision) to extract text content
3. WHEN a multi-page PDF contains a mix of searchable pages and scanned pages, THE Policy_Parser SHALL use pdf-parse for searchable pages and invoke OCR_Service for pages without embedded selectable text
4. WHEN OCR_Service completes text extraction, THE Policy_Parser SHALL store the extracted text associated with the uploaded document, preserving page order and page boundaries
5. IF OCR_Service returns extracted text with a confidence score below 60% for a document, THEN THE Policy_Parser SHALL notify the user that the document could not be processed reliably and suggest re-uploading a clearer copy
6. IF OCR_Service is unavailable or returns an error response, THEN THE Policy_Parser SHALL notify the user of a temporary processing failure and allow retry
7. THE Policy_Parser SHALL support extraction from multi-page policy documents of at least 100 pages

### Requirement 3: AI Policy Analysis

**User Story:** As an individual policyholder, I want my policy automatically analyzed into structured categories, so that I can quickly understand what my policy covers and where the risks are.

#### Acceptance Criteria

1. WHEN text extraction completes for a policy document, THE AI_Engine SHALL produce a structured analysis within 60 seconds containing: coverage details, exclusions, waiting periods, financial limits, co-pay percentages, deductibles, and hidden clauses
2. WHEN the AI_Engine analyzes coverage details, THE AI_Engine SHALL categorize coverage into types including Hospitalization, Day-care, Ambulance, ICU, and OPD when the policy document contains language referencing that coverage type
3. WHEN the AI_Engine identifies exclusions, THE AI_Engine SHALL list each exclusion with a plain-English explanation of no more than 100 words per exclusion
4. WHEN the AI_Engine identifies waiting periods, THE AI_Engine SHALL categorize them by their stated duration and specify which conditions or treatments each waiting period applies to
5. WHEN the AI_Engine identifies financial limits, THE AI_Engine SHALL extract specific caps (room rent cap, ICU cap, procedure-specific limits) with their monetary values
6. WHEN the AI_Engine identifies co-pay clauses, THE AI_Engine SHALL extract the co-pay percentage and the conditions under which co-pay applies
7. WHEN the AI_Engine identifies clauses that impose conditions, limitations, or penalties not referenced in the policy summary or table of contents, THE AI_Engine SHALL flag each clause with a risk indicator of High, Medium, or Low based on potential financial impact to the policyholder, and provide a plain-English explanation of the impact in no more than 100 words
8. WHEN analysis completes, THE AI_Engine SHALL compute a Health_Score on a scale of 0 to 100 where 0 represents the lowest coverage quality and 100 represents the highest, based on weighted evaluation of: coverage breadth, waiting period lengths, number and severity of exclusions, financial limit restrictions, co-pay levels, and claim settlement ratio where available
9. IF the AI_Engine cannot identify any items for a given category (exclusions, waiting periods, financial limits, co-pay clauses, or hidden clauses), THEN THE AI_Engine SHALL explicitly indicate that no items were found for that category rather than omitting the category from the output
10. IF the AI_Engine cannot complete the analysis due to unreadable or ambiguous policy content, THEN THE AI_Engine SHALL return a partial analysis with the successfully analyzed categories and indicate which categories could not be analyzed with a reason for the failure

### Requirement 4: Policy Dashboard

**User Story:** As an individual policyholder, I want a visual dashboard summarizing my policy details, so that I can see all critical information at a glance.

#### Acceptance Criteria

1. WHEN a policy analysis is complete, THE Customer_Portal SHALL display a dashboard showing: premium amount, sum insured, insurance provider name, Health_Score, a coverage summary listing covered category types, an exclusions summary listing exclusion count and top exclusions, risk flags, waiting periods grouped by duration, and AI recommendations
2. WHEN risk flags are identified in a policy, THE Customer_Portal SHALL display the count of risk flags in a visually distinct element positioned above the fold on the dashboard (e.g., "3 risk flags found")
3. WHEN the Health_Score is computed, THE Customer_Portal SHALL display the numeric score (0-100) with a visual indicator mapped to quality levels: 0-40 (Poor), 41-60 (Fair), 61-80 (Good), 81-100 (Excellent)
4. WHEN AI-generated recommendations are available for a policy, THE Customer_Portal SHALL display up to 5 recommendations, each indicating whether it addresses a coverage gap or a risk flag
5. IF a policy analysis completes with no risk flags identified, THEN THE Customer_Portal SHALL display a confirmation message indicating no risk flags were found
6. IF a policy analysis completes with no AI recommendations generated, THEN THE Customer_Portal SHALL display a message indicating the policy has no identified improvement areas

### Requirement 5: AI Insurance Chat

**User Story:** As an individual policyholder, I want to ask questions about my policy in plain language, so that I can get specific answers without reading the entire document.

#### Acceptance Criteria

1. WHEN a user submits a question about an uploaded policy, THE AI_Engine SHALL return an answer grounded exclusively in the content of the uploaded policy document within 10 seconds
2. WHEN the AI_Engine generates a response, THE AI_Engine SHALL reference the specific clauses or sections from the policy that support the answer, citing at least one source section per response
3. WHEN a user submits a question, THE AI_Engine SHALL use semantic search via Vector_Store to retrieve the top 5 most relevant Policy_Chunks (by cosine similarity) before generating an answer
4. IF the user asks a question that cannot be answered from the policy content, THEN THE AI_Engine SHALL inform the user that the information is not available in the uploaded policy and suggest what types of questions can be answered
5. WHEN a user submits a question, THE AI_Engine SHALL respond in plain English at or below an 8th-grade reading level, avoiding insurance jargon unless the user specifically asks for technical details
6. IF a user submits a question about a policy that is still being processed by the Background_Processor, THEN THE AI_Engine SHALL inform the user that the policy analysis is not yet complete and indicate the current processing stage
7. IF a user submits a question exceeding 500 characters, THEN THE AI_Engine SHALL reject the input and inform the user of the maximum allowed question length

### Requirement 6: Policy Vault

**User Story:** As a policyholder or family manager, I want to store and organize multiple insurance policies in one place, so that I can access all family coverage information centrally.

#### Acceptance Criteria

1. THE Customer_Portal SHALL allow users to store multiple policies in the Policy_Vault up to the limit defined by their subscription tier
2. THE Customer_Portal SHALL categorize policies by type: Health, Life, Motor, Travel, and Home
3. WHEN a user searches within the Policy_Vault, THE Customer_Portal SHALL filter policies by name, type, provider, or family member and display results within 2 seconds
4. THE Customer_Portal SHALL allow users to download original policy documents from the Policy_Vault
5. WHEN a user deletes a policy from the Policy_Vault, THE Customer_Portal SHALL display a confirmation dialog and, upon confirmation, remove the policy and all associated analysis data, embeddings, and extracted text
6. THE Customer_Portal SHALL allow users to organize policies by family member by assigning each policy to a named family member
7. IF a download request fails due to storage unavailability, THEN THE Customer_Portal SHALL display an error message and allow the user to retry

### Requirement 7: Policy Comparison

**User Story:** As a policyholder, I want to compare two insurance policies side by side, so that I can make an informed decision about which policy offers better value.

#### Acceptance Criteria

1. WHEN a user selects two policies from the Policy_Vault for comparison, THE AI_Engine SHALL produce a structured comparison covering: premium, coverage amounts (sum insured, room rent cap, ICU cap, procedure-specific limits), waiting periods, co-pay levels, exclusions, and Health_Score
2. WHEN a comparison is generated, THE AI_Engine SHALL provide a recommendation indicating which policy has a higher Health_Score overall and a plain-English explanation referencing the specific categories (coverage, waiting periods, exclusions, co-pay, claim friendliness) that contributed to the score difference
3. WHEN comparison results are available, THE Customer_Portal SHALL display the results with a numerical score (0-100) for each policy derived from the Health_Score
4. WHEN comparison results are available, THE Customer_Portal SHALL highlight differences between the two policies with visual indicators showing which policy scores higher for each comparison category
5. IF the AI_Engine cannot generate a comparison (e.g., one or both policies have not completed analysis), THEN THE AI_Engine SHALL return an error indication specifying which policy lacks completed analysis and prompt the user to complete processing before comparing

### Requirement 8: Claim Simulator

**User Story:** As a policyholder, I want to simulate a claim scenario before filing, so that I can understand if my claim is likely to be approved and what limitations may apply.

#### Acceptance Criteria

1. WHEN a user describes a claim scenario in plain language and selects a policy from the Policy_Vault, THE Claim_Simulator SHALL evaluate the scenario against the selected policy's terms
2. WHEN evaluating a scenario, THE Claim_Simulator SHALL check: applicable waiting periods (relative to the policy start date), coverage applicability, exclusion matches, financial limit applicability, and co-pay requirements
3. WHEN evaluation completes, THE Claim_Simulator SHALL return an approval probability as a percentage (0-100%) with a list of reasons supporting the assessment, where each reason references the relevant policy term
4. WHEN coverage applies to the scenario, THE Claim_Simulator SHALL indicate which coverage items are satisfied (e.g., "Hospitalisation covered", "Waiting period satisfied", "Co-payment applies")
5. IF the scenario matches an exclusion in the policy, THEN THE Claim_Simulator SHALL state which exclusion applies by name and explain the impact on the claim in plain English
6. IF the user-described scenario does not contain sufficient detail to evaluate against policy terms, THEN THE Claim_Simulator SHALL prompt the user to provide additional information specifying what details are needed
7. IF the scenario does not match any coverage area defined in the policy, THEN THE Claim_Simulator SHALL inform the user that the described scenario is not covered under the selected policy and indicate the coverage areas that are available

### Requirement 9: Broker Dashboard

**User Story:** As an insurance broker, I want a comprehensive dashboard with key metrics, so that I can monitor my business performance at a glance.

#### Acceptance Criteria

1. THE Broker_Portal SHALL display a dashboard showing: Total Premium (calendar year-to-date), Active Policies count, Total Clients count, Renewals Due (policies with renewal dates within the next 30 days) count, and Pending Claims count
2. THE Broker_Portal SHALL display Premium Collection data as a monthly chart covering the last 12 months with breakdowns by insurance type
3. THE Broker_Portal SHALL display Commission Overview showing: total commission earned, paid commission, pending commission, and overdue commission (unpaid beyond 30 days past the scheduled payment date) amounts, each displayed to 2 decimal places in the broker's configured currency
4. WHEN data changes in the system, THE Broker_Portal SHALL reflect updated metrics on the dashboard without requiring a manual page refresh within 60 seconds
5. THE Broker_Portal SHALL load and display the complete dashboard within 5 seconds of the broker navigating to the dashboard view
6. IF no data is available for a given metric, THEN THE Broker_Portal SHALL display a zero value for counts and amounts, and display an empty state indication for the premium chart

### Requirement 10: Broker Client Management

**User Story:** As an insurance broker, I want to manage my client database with detailed profiles, so that I can track client coverage and identify service opportunities.

#### Acceptance Criteria

1. THE Broker_Portal SHALL allow brokers to add, edit, search, and view client records with required fields: full name, email, phone number, and at least one associated policy
2. WHEN a broker views a client profile, THE Broker_Portal SHALL display client details including personal information (name, email, phone), all associated policies with status, and identified Coverage_Gaps generated by the AI_Engine
3. THE Broker_Portal SHALL provide a Client Risk Dashboard identifying with counts: underinsured clients, clients missing family coverage, clients with high deductible policies (deductible exceeding ₹50,000), clients with upcoming waiting periods ending within 30 days, and clients without health insurance
4. WHEN a broker searches for clients, THE Broker_Portal SHALL support filtering by name, policy type, risk status, and renewal date and return results within 3 seconds
5. IF a broker attempts to add a client without providing all required fields, THEN THE Broker_Portal SHALL display an error message indicating which fields are missing

### Requirement 11: Broker Policy Management

**User Story:** As an insurance broker, I want to manage all client policies in one system, so that I can track policy status, renewals, and premiums efficiently.

#### Acceptance Criteria

1. THE Broker_Portal SHALL allow brokers to add new policies with required fields (client name, policy type, insurer, start date, end date, premium amount, and payment frequency), view a paginated list of all policies (maximum 50 per page), and display each policy's current status as one of: Active, Pending Renewal, Expired, or Cancelled
2. THE Broker_Portal SHALL display a Renewal_Calendar showing policy renewals due within the next 90 days, including renewal dates and premium amounts
3. WHEN a policy renewal is due within 30 days, THE Broker_Portal SHALL display the renewal entry in the Renewal_Calendar with a visually distinct indicator differentiating it from renewals due beyond 30 days
4. THE Broker_Portal SHALL provide a Premium_Tracker displaying collection status (Paid, Pending, Overdue) with monthly charts for the last 12 months and breakdowns by insurance type
5. WHEN a broker initiates renewal reminders, THE Broker_Portal SHALL send notifications to all clients whose policies are due for renewal within the broker-selected time period and display a confirmation summary showing the count of notifications sent
6. IF a broker submits a new policy with missing required fields or an end date earlier than the start date, THEN THE Broker_Portal SHALL display an error message indicating the specific validation failure and preserve the entered data
7. IF notification delivery fails for one or more clients, THEN THE Broker_Portal SHALL display a summary indicating which client notifications failed and allow the broker to retry sending to the failed recipients

### Requirement 12: Broker Claims Management

**User Story:** As an insurance broker, I want to track claims for all my clients, so that I can assist clients through the claims process and monitor outcomes.

#### Acceptance Criteria

1. THE Broker_Portal SHALL display all client claims with their current status (approved, under review, pending, rejected), showing for each claim: client name, policy number, claim submission date, claim type, and claimed amount, with a maximum of 50 claims per page
2. WHEN a claim status changes, THE Broker_Portal SHALL update the displayed status within 5 seconds and send an in-app notification to the broker indicating the client name, claim reference, and new status
3. THE Broker_Portal SHALL allow brokers to filter claims by status, client, policy type, and date range, and SHALL display a message indicating no results found when no claims match the selected filter criteria
4. THE Broker_Portal SHALL provide a Claim Assistant that presents a step-by-step workflow for filing a claim on behalf of a client, collecting required information (policy selection, incident date, incident description, and supporting document uploads) across sequential steps before submission
5. IF a broker submits a claim through the Claim Assistant with missing required information, THEN THE Broker_Portal SHALL prevent submission and indicate which fields require completion

### Requirement 13: Broker AI Insights

**User Story:** As an insurance broker, I want AI-generated business insights, so that I can identify upselling opportunities and better serve my clients.

#### Acceptance Criteria

1. THE AI_Engine SHALL generate recommendations for brokers based on client portfolio analysis, where each recommendation references at least one specific client and the relevant policy attribute (e.g., "12 clients can benefit from higher health cover", "7 policies have room rent restrictions"), refreshed at least once every 24 hours
2. WHEN the AI_Engine identifies a Coverage_Gap for a client, THE Broker_Portal SHALL include the gap in the broker recommendations list within 60 seconds of identification
3. THE Broker_Portal SHALL categorize AI insights by type: upselling opportunities, risk alerts, renewal optimization, and coverage improvement suggestions
4. WHEN a broker views AI insights, THE Broker_Portal SHALL display for each recommendation: the affected client(s), the relevant policy or coverage attribute, and a textual explanation of why the recommendation was generated
5. IF the AI_Engine is unable to generate recommendations due to insufficient client data or service unavailability, THEN THE Broker_Portal SHALL display a notification indicating that insights are temporarily unavailable and show the timestamp of the last successfully generated insights

### Requirement 14: Broker Quick Actions

**User Story:** As an insurance broker, I want quick access to common tasks, so that I can perform routine operations efficiently without navigating through multiple menus.

#### Acceptance Criteria

1. THE Broker_Portal SHALL provide exactly 8 Quick Action shortcuts on the dashboard: Add Client, Add Policy, Compare Policies, AI Policy Analysis, Premium Calculator, Generate Report, Send Renewal Reminders, and Claim Assistant
2. WHEN a broker activates a Quick Action, THE Broker_Portal SHALL navigate directly to the relevant workflow within 2 seconds without intermediate steps
3. THE Broker_Portal SHALL display Quick Actions in a dedicated section on the dashboard visible without scrolling on viewports of 1024px width or greater
4. IF a Quick Action requires a prerequisite (e.g., Compare Policies requires at least two policies), THEN THE Broker_Portal SHALL display a message indicating the prerequisite is not met rather than navigating to an empty workflow

### Requirement 15: Vector-Based Semantic Search

**User Story:** As a policyholder, I want to search my policy using natural language, so that I can find relevant clauses without knowing exact legal terminology.

#### Acceptance Criteria

1. WHEN a policy document is processed, THE AI_Engine SHALL split the document into Policy_Chunks of no more than 512 tokens each with overlapping context between consecutive chunks, generate embeddings for each chunk, and store the embeddings in the Vector_Store
2. WHEN a user performs a semantic search query against a specific policy, THE AI_Engine SHALL retrieve up to 10 Policy_Chunks from the Vector_Store ranked by cosine similarity, including only chunks with a similarity score at or above 0.7
3. WHEN search results are returned, THE Customer_Portal SHALL display the matching clauses in descending order of similarity, showing the match confidence percentage and the source section of the policy for each result
4. WHEN generating a chat response, THE AI_Engine SHALL use the retrieved Policy_Chunks as context to ensure answers are grounded in policy content
5. IF a semantic search query returns no Policy_Chunks meeting the minimum similarity threshold, THEN THE Customer_Portal SHALL inform the user that no relevant clauses were found and suggest rephrasing the query

### Requirement 16: Background Processing Pipeline

**User Story:** As a user, I want document processing to happen asynchronously with progress updates, so that I can continue using the application while my policy is being analyzed.

#### Acceptance Criteria

1. WHEN a document is uploaded, THE Background_Processor SHALL create a processing job and return a job acknowledgment to the user within 2 seconds
2. WHILE a job is processing, THE Background_Processor SHALL emit progress updates at each stage transition (Upload received → OCR in progress → AI Analysis in progress → Complete) within 5 seconds of entering each stage
3. WHEN a processing job completes, THE Background_Processor SHALL notify the user that the analysis is ready for viewing
4. IF a processing job fails at any stage, THEN THE Background_Processor SHALL notify the user of the failure, specify the failed stage, and offer a manual retry option up to a maximum of 3 retry attempts per job
5. THE Background_Processor SHALL process uploaded documents within 40 seconds for standard policy documents (up to 50 pages)
6. IF a document exceeds 50 pages, THEN THE Background_Processor SHALL inform the user of extended processing time before beginning the job
7. WHILE the Background_Processor has reached a maximum of 5 concurrent jobs per user, THE Background_Processor SHALL queue subsequent upload jobs and display the queue position to the user

### Requirement 17: User Authentication and Authorization

**User Story:** As a platform user, I want secure access to my account and data, so that my policy information remains private and protected.

#### Acceptance Criteria

1. THE PolicyLens SHALL authenticate users via Supabase Auth before granting access to any portal
2. IF an authenticated user attempts to access a portal that does not match their assigned role, THEN THE PolicyLens SHALL deny access and display a message indicating insufficient permissions
3. WHEN an unauthenticated user accesses the landing page, THE Customer_Portal SHALL allow uploading and analyzing a single policy document without requiring account creation
4. IF an authentication session expires, THEN THE PolicyLens SHALL redirect the user to the login page within 5 seconds and preserve the intended destination URL for post-login redirect
5. THE PolicyLens SHALL enforce role-based access control ensuring that Customer_Portal users cannot access Broker_Portal or Corporate_Portal resources, and Broker_Portal users cannot access Corporate_Portal resources

### Requirement 18: Freemium Access Control

**User Story:** As a platform operator, I want to offer tiered access levels, so that users can try basic features for free and upgrade for full functionality.

#### Acceptance Criteria

1. WHILE a user is on the Free tier, THE Customer_Portal SHALL limit the number of policy uploads to a maximum of 3 policies and reject further uploads once the limit is reached
2. WHILE a user is on the Free tier, THE Customer_Portal SHALL provide AI analysis limited to Health_Score, coverage summary, and exclusions list, and restrict access to Claim_Simulator, Policy Comparison, family vault, and renewal tracking features
3. WHILE a user is on the Premium tier, THE Customer_Portal SHALL provide AI analysis with no tier-imposed restrictions, including full Claim_Simulator access, Policy Comparison, family vault, and renewal tracking
4. WHEN a free-tier user attempts to access a premium feature, THE Customer_Portal SHALL display an upgrade prompt that identifies the restricted feature by name and presents available pricing options
5. IF a free-tier user attempts to upload a policy after reaching the 3-policy upload limit, THEN THE Customer_Portal SHALL reject the upload and display a message indicating the upload limit has been reached along with an upgrade prompt
6. WHEN a user upgrades from Free tier to Premium tier, THE Customer_Portal SHALL grant immediate access to all premium features and remove upload restrictions without requiring re-upload of existing policies

### Requirement 19: Broker Portal Navigation and Structure

**User Story:** As an insurance broker, I want a well-organized portal with clear navigation, so that I can efficiently access all business management tools.

#### Acceptance Criteria

1. THE Broker_Portal SHALL provide a persistent sidebar navigation visible on all pages with sections: Dashboard, Clients, Policies, Renewals, Premiums, Commission, Claims, Leads, AI Assistant, Reports, Analytics, Documents, Team, and Settings
2. THE Broker_Portal SHALL visually highlight the currently active navigation section so that the broker can identify their location within the portal
3. THE Broker_Portal SHALL use a white background, blue/navy sidebar, and card-based layout for data display
4. THE Broker_Portal SHALL provide a Leads Management section that allows the broker to view, add, edit, and remove prospective client records
5. THE Broker_Portal SHALL provide a Team Management section that allows the broker to view, add, and remove team members and assign or revoke role-based permissions
6. THE Broker_Portal SHALL provide a Documents section that allows the broker to upload, download, delete, and categorize documents by client or policy
7. THE Broker_Portal SHALL provide Reports and Analytics sections that allow the broker to generate and view reports covering policy volume, premium revenue, claims activity, and commission earned
8. WHEN the broker selects any navigation section, THE Broker_Portal SHALL display the corresponding section content within 3 seconds

### Requirement 20: Customer Portal Landing Page

**User Story:** As a prospective user visiting the platform, I want a clear and engaging landing page, so that I understand the value of PolicyLens and can try the product without commitment.

#### Acceptance Criteria

1. THE Customer_Portal SHALL display a landing page with the headline "Insurance policies are written to be skimmed past. We read them anyway."
2. THE Customer_Portal SHALL display the four-step process (Upload → Extract → Analyze → Decide) on the landing page
3. THE Customer_Portal SHALL display coverage type support (Health, Motor, Life, Travel) and compatibility with scanned and typed PDFs on the landing page
4. THE Customer_Portal SHALL display the message "No account needed to preview. Results in under 40 seconds" on the landing page
5. THE Customer_Portal SHALL use a dark theme with navy/dark blue background and teal/mint green accent color
6. THE Customer_Portal SHALL include a footer with navigable links organized into sections: Product (Features, How it works, Analyze a policy), Coverage Types (Health, Motor, Life, Travel), and Company (About, Privacy, Terms)
7. THE Customer_Portal SHALL display a primary call-to-action on the landing page that directs the user to the policy upload and analysis workflow without requiring account creation

### Requirement 21: Policy Document Storage

**User Story:** As a policyholder, I want my uploaded documents stored securely, so that I can access my original policies and analysis results at any time.

#### Acceptance Criteria

1. THE PolicyLens SHALL store uploaded policy documents in Supabase Storage with access restricted to the document owner via row-level security policies
2. THE PolicyLens SHALL retain the original uploaded document alongside the extracted text and analysis results as separate retrievable records
3. WHEN a user requests to download a stored document, THE PolicyLens SHALL serve the original uploaded file in its original format within 5 seconds
4. IF a user deletes their account, THEN THE PolicyLens SHALL remove all associated documents, extracted text, embeddings, and analysis data within 30 days
5. IF Supabase Storage is temporarily unavailable during an upload, THEN THE PolicyLens SHALL notify the user of a temporary storage failure and allow retry
