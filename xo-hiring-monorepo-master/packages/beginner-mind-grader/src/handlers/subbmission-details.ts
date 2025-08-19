export const SubmissionObjective = `
Solve Business Problems with AI
Objective
Develop a proof-of-concept application to intelligently process email order requests and customer inquiries for a fashion store. The system should accurately categorize emails as either product inquiries or order requests and generate appropriate responses using the product catalog information and current stock status.

You are encouraged to use AI assistants (like ChatGPT or Claude) and any IDE of your choice to develop your solution. Many modern IDEs (such as PyCharm, or Cursor) can work with Jupiter files directly.

Task Description
Inputs
Google Spreadsheet Document containing:
Products: List of products with fields including product ID, name, category, stock amount, detailed description, and season.
Emails: Sequential list of emails with fields such as email ID, subject, and body.

Instructions
Implement all requirements using advanced Large Language Models (LLMs) to handle complex tasks, process extensive data, and generate accurate outputs effectively.
Use Retrieval-Augmented Generation (RAG) and vector store techniques where applicable to retrieve relevant information and generate responses.
You are provided with a temporary OpenAI API key granting access to GPT-4o, which has a token quota. Use it wisely or use your own key if preferred.
Address the requirements in the order listed. Review them in advance to develop a general implementation plan before starting.
Your deliverables should include:
Code developed within this notebook.
A single spreadsheet containing results, organized across separate sheets.
Comments detailing your thought process.
You may use additional libraries (e.g., langchain) to streamline the solution. Use libraries appropriately to align with best practices for AI and LLM tools.
Use the most suitable AI techniques for each task. Note that solving tasks with traditional programming methods will not earn points, as this assessment evaluates your knowledge of LLM tools and best practices.
Requirements
1. Classify emails
Classify each email as either a "product inquiry" or an "order request". Ensure that the classification accurately reflects the intent of the email.
Output: Populate the email-classification sheet with columns: email ID, category.

2. Process order requests
Process orders
For each order request, verify product availability in stock.
If the order can be fulfilled, create a new order line with the status “created”.
If the order cannot be fulfilled due to insufficient stock, create a line with the status “out of stock” and include the requested quantity.
Update stock levels after processing each order.
Record each product request from the email.
Output: Populate the order-status sheet with columns: email ID, product ID, quantity, status ("created", "out of stock").
Generate responses
Create response emails based on the order processing results:
If the order is fully processed, inform the customer and provide product details.
If the order cannot be fulfilled or is only partially fulfilled, explain the situation, specify the out-of-stock items, and suggest alternatives or options (e.g., waiting for restock).
Ensure the email tone is professional and production-ready.
Output: Populate the order-response sheet with columns: email ID, response.

3. Handle product inquiry
Customers may ask general open questions.
Respond to product inquiries using relevant information from the product catalog.
Ensure your solution scales to handle a full catalog of over 100,000 products without exceeding token limits. Avoid including the entire catalog in the prompt.
Output: Populate the inquiry-response sheet with columns: email ID, response.
Evaluation Criteria
Advanced AI Techniques: The system should use Retrieval-Augmented Generation (RAG) and vector store techniques to retrieve relevant information from data sources and use it to respond to customer inquiries.
Tone Adaptation: The AI should adapt its tone appropriately based on the context of the customer's inquiry. Responses should be informative and enhance the customer experience.
Code Completeness: All functionalities outlined in the requirements must be fully implemented and operational as described.
Code Quality and Clarity: The code should be well-organized, with clear logic and a structured approach. It should be easy to understand and maintain.
Presence of Expected Outputs: All specified outputs must be correctly generated and saved in the appropriate sheets of the output spreadsheet. Ensure the format of each output matches the requirements—do not add extra columns or sheets.
Accuracy of Outputs: The accuracy of the generated outputs is crucial and will significantly impact the evaluation of your submission.
We look forward to seeing your solution and your approach to solving real-world problems with AI technologies.
`.trim();

export const GradingRubric = `
Email Classification:
  - 0-stars: Solution is not provided or does not use LLM.
  - 1-star: Email classification is attempted using LLM but accuracy is below 70%.
  - 2-stars: Solution is implemented using LLM and has average accuracy in range from 70% to 90%.
  - 3-stars: Solution is implemented using LLM and demonstrates high level of accuracy over 90%.

Process Order Requests:
  - 0-stars: Solution is not provided or does not use LLM.
  - 1-star: Orders are processed using LLM, but order status accuracy is below 50%.
  - 2-stars: Orders are processed using LLM, order status accuracy is above 50% AND The solution uses product stock information, and keeps it updated.
  - 3-stars: Orders are processed using LLM with accuracy above 70% AND The solution uses product stock information, and keeps it updated AND Must generate relevant order response emails with LLM.

Handle Product Inquiries:
  - 0-stars: Solution is not provided or does not use LLM.
  - 1-star: Solution uses LLM to generate relevant responses to inquiries but implemented with basic prompting, embedding all context information into the prompt (no filtering at all).
  - 2-stars: Solution uses LLM to generate relevant responses to inquiries and filters the product database to reduce the context size. Any type of filtering is applicable (keyword-based, fuzzy-search, etc) - the intention to reduce the context size is important.
  - 3-stars: Solution uses LLM to generate relevant responses to inquiries and is using vector search to prepare the context. RAG and vector store usage also belong to this category.
`.trim();
