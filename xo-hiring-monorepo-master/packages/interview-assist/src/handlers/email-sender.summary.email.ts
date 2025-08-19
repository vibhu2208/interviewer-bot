export const emailTemplate = `<!DOCTYPE html>
<html>
  <head>
    <meta charset="UTF-8" />
    <title>Ready for Grading: {{ candidateName }}'s {{ position }} Interview</title>
  </head>
  <body style="font-family: Arial, sans-serif; color: #333; line-height: 1.6;">
    <p>Dear {{ hiringManagerName }},</p>

    <p>
      Please find below the AI-generated summary of your recent interview 
      with <strong>{{ candidateName }}</strong> for the <strong>{{ position }}</strong> role.
    </p>

    <p>
      The full interview recording is available on Read.AI: 
      <a href="{{ readAILink }}" target="_blank">{{ readAILink }}</a>
      <br/>
      Please grade the candidate: 
      <a href="{{ gradeLink }}" target="_blank">{{ gradeLink }}</a>
    </p>

    {{ summary }}

    <p>
      Please don’t hesitate to reach out if you need any clarification 
      or have feedback about this summary.
    </p>

    <p>Regards,<br/>
    Crossover</p>
  </body>
</html>`;
