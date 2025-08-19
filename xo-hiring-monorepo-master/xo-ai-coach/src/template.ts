/**
 * This email template is too big to put it into the SSM
 * We will use it as a fallback implementation
 * The template can be overridden by placing email-template.html into the root folder of the data bucket
 */
export const EmailTemplate = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style type="text/css">
        body {
            font-family: Arial, sans-serif;
            margin: 0;
            padding: 0;
            background-color: #f4f4f4;
        }
        .container {
            max-width: 600px;
            margin: 0 auto;
            background: #ffffff;
        }
        .header {
            text-align: center;
            padding: 20px;
        }
        .content {
            padding: 20px;
        }
        .footer {
            text-align: center;
            padding: 20px;
            font-size: 12px;
            color: #666666;
        }
        h1, h2, h3 {
            color: #3bc4b2;
        }
        p {
            color: #333333;
            line-height: 1.6;
        }
        a {
            color: #006699;
        }
        .disclaimer, .feedback {
            background-color: #f8f8f8;
            padding: 5px;
            border-left: 4px solid #3bc4b2;
            font-size: 0.9em; /* Reduced text size */
        }
        .feedback ul {
            list-style-type: disc;
            padding-left: 20px;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="content">
            <p>Hello {{userName}},</p>
            <p>
                We are excited to share how our teams are innovatively using AI tools, fueling efficiency and innovation. As the GenAI field rapidly evolves with new tools and ideas emerging constantly, our commitment to embracing these advancements is more crucial than ever. Our goal is for each team member to harness these tools effectively, enhancing our collective skill set. In this weekly update, we'll provide key statistics to gauge our progress, spotlighting the impactful ways Crossover teams are integrating GenAI into their work.
            </p>

            <!-- User AI Tool Usage Summary -->
            <h3>Your AI Tool Usage Summary This Week:</h3>
            <p><strong>Total Time Spent on AI Tools:</strong> {{totalTimeSpent}} hours</p>
            <p><strong>Top 5 AI Tools You Used:</strong></p>
            <ul>
                {{#each userApplications}}
                <li>{{name}}: {{time}} hours</li>
                {{/each}}
            </ul>

            <!-- Team Insights -->
            <h3>Team Insights: {{teamName}}</h3>
            <p><strong>Average Use Per Person in Your Team:</strong> {{teamAverageUsage}} hours</p>
            <p><strong>Top 3 Contributors in AI Tool Usage:</strong></p>
            <ol>
                {{#each teamTopUsers}}
                <li>{{name}}: {{time}} hours</li>
                {{/each}}
            </ol>
            <p><strong>Team Size:</strong> {{teamSize}}</p>
            <p><strong>Most Popular Tools in the Team:</strong></p>
            <ul>
                {{#each teamTopToolData}}
                <li>{{name}}: {{time}} hours</li>
                {{/each}}
            </ul>

            <!-- Company-wide AI Tool Usage -->
            <h3>Company-wide AI Tool Usage:</h3>
            <p><strong>Average Time Spent by Top 10% Users:</strong> {{globalUsage.avgTop10Percent}} hours</p>
            <p><strong>Average Time Spent by Top 50% Users:</strong> {{globalUsage.avgTop50Percent}} hours</p>
            <p><strong>Most Popular Tools Across Crossover:</strong></p>
            <ol>
                {{#each globalApps}}
                <li>{{name}}</li>
                {{/each}}
            </ol>

            <!-- Disclaimer Section -->
            <div class="disclaimer">
                <h3>Disclaimer</h3>
                <p>This report is compiled based on data from the WorkSmart tracker. We strive to keep the list of AI-first apps up-to-date in the AI category in WorkSmart, but acknowledge the need for constant maintenance. Note that this report does not currently track the usage of AI add-ons in standard applications, such as Google Duet in Google Docs or GitHub Copilot in your IDE.</p>
            </div>
            <br/>

            <!-- Feedback Section -->
            <div class="feedback">
                <h3>We Value Your Feedback</h3>
                <ul>
                    <li>Inform us about any AI tools you use that are not listed in this report.</li>
                    <li>Share details of any AI add-ons you're utilizing that are not captured.</li>
                    <li>Provide feedback if this report does not accurately reflect your AI tool usage.</li>
                </ul>
                <p>Please submit your input through this form: <a href="https://forms.gle/cNU4WRgRqg4sfR9HA">Submit your input</a>.</p>
            </div>
        </div>
        <div class="footer">
            <p>&copy; Crossover. All rights reserved.</p>
        </div>
    </div>
</body>
</html>
`;
