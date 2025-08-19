export const graderReminderEmailTemplate = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Crossover Interview Notes Generation</title>
  <style>
    body {
      margin: 0;
      padding: 0;
      font-family: Arial, sans-serif;
      line-height: 1.6;
      color: #333;
    }
    .container {
      width: 100%;
      max-width: 600px;
      margin: 0 auto;
      padding: 20px;
    }
    h1, h3 {
      color: #222;
    }
    p, li {
      font-size: 14px;
      margin: 0 0 10px;
    }
    a {
      color: #007BFF;
      text-decoration: none;
    }
    a:hover {
      text-decoration: underline;
    }
    .btn {
      display: inline-block;
      margin: 10px 0;
      padding: 10px 20px;
      background-color: #007BFF;
      color: #ffffff !important;
      text-decoration: none;
      border-radius: 4px;
      font-size: 14px;
    }
    .btn:hover {
      background-color: #0056b3;
    }
    .highlight {
      font-weight: bold;
    }
    .qna p {
      margin: 5px 0;
    }
  </style>
</head>
<body>
  <div class="container">
    <p>Dear <span class="highlight">{{ graderName }}</span>,</p>

    <p>We noticed that you conducted an interview recently with Crossover.</p>
    
    <p>
      Crossover now offers automatic interview notes generation by integrating 
      with <strong>Read.ai</strong>. This integration centralizes all interview-related 
      insights into one easy-to-access location, tailored specifically for hiring—not 
      just generic meeting summaries.
    </p>
    
    <p>
      With this feature, you’ll save time, make better decisions, and ensure no critical 
      candidate information slips through the cracks. It also helps OrgBuilders refine 
      your pipeline by identifying gaps and improving the quality of your candidates.
    </p>
    
    <h3>Why Set This Up Now?</h3>
    <ul>
      <li><strong>Save Hours:</strong> No more juggling scattered notes or relying on memory—get detailed, AI-powered interview summaries delivered instantly.</li>
      <li><strong>Hire Smarter:</strong> Gain structured insights that analyze each candidate’s strengths, areas for improvement, and fit for the role.</li>
      <li><strong>Boost Your Pipeline:</strong> Allow OrgBuilders to use these insights to fill blind spots in your hiring process and improve future outcomes.</li>
    </ul>
    
    <h3>Set It Up in 10 seconds</h3>
    <ol>
      <li>Go to the Read.ai integrations page: 
        <a href="https://app.read.ai/analytics/integrations/user/workflow/webhooks">
          https://app.read.ai/analytics/integrations/user/workflow/webhooks
        </a>
      </li>
      <li>Click <strong>"Add Webhook"</strong>.</li>
      <li>Set the name to <strong>Crossover Interview</strong>.</li>
      <li>
        Set the URL to: 
        <a href="https://interview-assist-api.crossover.com/readai-webhook/{{ graderId }}">
          https://interview-assist-api.crossover.com/readai-webhook/{{ graderId }}
        </a>
      </li>
    </ol>
    
    <h3 id="if-you-don-t-have-read-ai-subscription-yet">If You Don&#39;t Have Read AI Subscription Yet</h3>
    <ol>
      <li>Go to the SaasOps portal (<a href="https://supportportal-df.atlassian.net/servicedesk/customer/portal/6/group/1113/create/1937">https://supportportal-df.atlassian.net/servicedesk/customer/portal/6/group/1113/create/1937</a>)</li>
      <li>For &quot;Contact us about&quot; select &quot;AI Services&quot;.</li>
      <li>For &quot;What can we help you with?&quot; select &quot;Order AI services / Order read.ai Service for a single Google account&quot;.</li>
      <li>Fill out the rest of the form.</li>
      <li>Once you got your subscription set up, you will be able to add the webhook.</li>
    </ol>
    
    <h3>Q&amp;A</h3>
    <div class="qna">
      <p><strong>Q: How do interview summaries benefit me?</strong></p>
      <p>
        A: These summaries are more than just notes—they’re actionable insights, created 
        with your specific job requirements in mind. They include:
      </p>
      <ul>
        <li>Key interview questions and answers.</li>
        <li>Highlights of candidate achievements and skills.</li>
        <li>Profile match analysis: requirements met, gaps, and transferable skills.</li>
        <li>Strengths and concerns to consider.</li>
        <li>Suggestions for follow-up questions or areas to explore.</li>
      </ul>
      <p>
        This isn’t just convenience—it’s a smarter, faster way to make confident hiring decisions.
      </p>

      <p><strong>Q: Where can I access the interview summaries?</strong></p>
      <p>
        A: Summaries are:
        <ul>
          <li>Available directly in the Job Application View on the Crossover platform.</li>
          <li>Delivered to your email immediately after each interview.</li>
        </ul>
      </p>

      <p><strong>Q: How will OrgBuilders use this information?</strong></p>
      <p>
        A: OrgBuilders use interview insights to identify critical skills or requirements that may 
        not have surfaced earlier. These insights help refine your pipeline, ensuring a smoother 
        hiring process and better candidates in the future.
      </p>

      <p><strong>Q: Will all my meetings be recorded by Crossover?</strong></p>
      <p>
        A: No. While Read.ai notifies Crossover of all meetings, only those booked through your 
        Calendly interview link are processed. Non-interview meetings are filtered out entirely.
      </p>
    </div>
    
    <p>Best regards,</p>
    <p>The Crossover Team</p>
  </div>
</body>
</html>
`;
