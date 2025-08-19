export const GRADING_ESCALATION_EMAIL_TEMPLATE = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Crossover Grading Escalation</title>
  <style>
    body {
      margin: 0;
      padding: 0;
      font-family: Arial, sans-serif;
      line-height: 1.6;
      color: #333;
      background-color: #f9f9f9;
    }
         .container {
       width: 100%;
       max-width: 1050px;
       margin: 0 auto;
       padding: 20px;
       background-color: #ffffff;
       border-radius: 8px;
       box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
     }
    h1, h2, h3 {
      color: #222;
      margin-top: 0;
    }
    h2 {
      color: #d32f2f;
      border-bottom: 2px solid #d32f2f;
      padding-bottom: 5px;
      margin-bottom: 15px;
    }
    h3 {
      color: #ff6b35;
      margin-bottom: 10px;
    }
         p, li {
       font-size: 14px;
       margin: 0 0 10px;
     }
     ul {
       margin: 10px 0;
       padding-left: 20px;
     }
     li {
       margin: 5px 0;
     }
    a {
      color: #007BFF;
      text-decoration: none;
    }
    a:hover {
      text-decoration: underline;
    }
    .highlight {
      font-weight: bold;
      color: #d32f2f;
    }
         .task-list {
       margin: 20px 0;
       padding: 15px;
       background-color: #fff3cd;
       border: 1px solid #ffeaa7;
       border-radius: 5px;
     }
     .task-list h2 {
       color: #856404;
       margin-top: 0;
       margin-bottom: 10px;
       font-size: 1.17em;
     }
    .task-item {
      margin: 10px 0;
      padding: 10px;
      background-color: #ffffff;
      border-radius: 4px;
      border: 1px solid #dee2e6;
    }
    .task-link {
      font-weight: bold;
      color: #007BFF;
      text-decoration: none;
      display: inline-block;
      margin-bottom: 5px;
    }
    .task-link:hover {
      text-decoration: underline;
    }
    .task-details {
      font-size: 13px;
      color: #666;
      margin-top: 5px;
    }
         .overdue-badge {
       background-color: #d32f2f;
       color: white;
       padding: 2px 8px;
       border-radius: 12px;
       font-size: 12px;
       font-weight: bold;
       margin-left: 10px;
     }
     .overdue-badge.warning {
       background-color: #ffc107;
       color: #212529;
     }
    .critical-section {
      background-color: #fff3cd;
      border: 1px solid #ffeaa7;
      border-radius: 5px;
      padding: 15px;
      margin: 20px 0;
    }
    .critical-section h3 {
      color: #856404;
      margin-top: 0;
    }
    .footer {
      margin-top: 30px;
      padding-top: 20px;
      border-top: 1px solid #dee2e6;
      color: #666;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>Grading Escalation Notice</h1>
    
    <p>Hi <span class="highlight">{{assignee.firstName}}</span>,</p>

    <p>Our candidate pipeline is stalled due to critical grading delays. Each ungraded assessment represents:</p>
    <ul>
      <li>Missed opportunities to bring world-class talent into our organizations</li>
      <li>Potential loss of top 1% candidates</li>
      <li>Erosion of our professional recruiting reputation</li>
    </ul>

    <p><strong>The attached list requires your immediate attention. These are potential game-changing hires.</strong></p>

    {{#if initial_items}}
    <div class="task-list">
      <h2>⚠️ High-Priority Candidate Assessments Requiring Immediate Review</h2>
      <p><strong>Just missed the 2 business days SLA</strong></p>
      
      {{#each initial_items}}
      <div class="task-item">
        <a href="{{link}}" class="task-link" target="_blank">{{subject}}</a>
        <span class="overdue-badge warning">{{days}} days overdue</span>
        <div class="task-details">
          {{#if candidate}}<strong>Candidate:</strong> <a href="{{profileLink}}" target="_blank">{{candidate}}</a> | {{/if}}
          <strong>{{#if (eq taskType "INTERVIEW")}}Scheduled{{else}}Submitted{{/if}}:</strong> {{date}}
        </div>
      </div>
      {{/each}}
    </div>
    {{/if}}

    {{#if followup_items}}
    <div class="critical-section">
      <h3>🚨 Critical: 24-Hour Follow‑Up Required</h3>
      <p><strong>Breached SLA by 3 or more business days</strong></p>
      
      {{#each followup_items}}
      <div class="task-item">
        <a href="{{link}}" class="task-link" target="_blank">{{subject}}</a>
        <span class="overdue-badge">{{days}} days overdue</span>
        <div class="task-details">
          {{#if candidate}}<strong>Candidate:</strong> <a href="{{profileLink}}" target="_blank">{{candidate}}</a> | {{/if}}
          <strong>{{#if (eq taskType "INTERVIEW")}}Scheduled{{else}}Submitted{{/if}}:</strong> {{date}}
        </div>
      </div>
      {{/each}}
    </div>
    {{/if}}

    <div class="critical-section">
      <h3>⚠️ Pipeline Preservation Protocol</h3>
      <p>Sustained grading delays will trigger our pipeline preservation protocol. This means we will:</p>
      <ul>
        <li>Pause job advertising to prevent accumulating ungraded candidate submissions</li>
        <li>Temporarily halt new interview scheduling</li>
        <li>Potentially close the pipeline to all new applicants</li>
      </ul>
      <p><strong>If you're overwhelmed, we're ready to help you manage the workload.</strong></p>
    </div>

    <div class="footer">
      <p>Best regards,<br>
      <strong>Crossover Team</strong></p>
    </div>
  </div>
</body>
</html>
`.trim();
