export const instructions = `
## Don’t forget to enable AI interview notes!

Crossover now offers automatic interview notes generation by integrating with Read.ai. This integration centralizes all interview-related insights into one easy-to-access location, tailored specifically for hiring—not just generic meeting summaries.

With this feature, you’ll save time, make better decisions, and ensure no critical candidate information slips through the cracks. It also helps OrgBuilders refine your pipeline by identifying gaps and improving the quality of your candidates.

### Why Set This Up Now?
* Save Hours: No more juggling scattered notes or relying on memory—get detailed, AI-powered interview summaries delivered instantly.
* Hire Smarter: Gain structured insights that analyze each candidate’s strengths, areas for improvement, and fit for the role.
* Boost Your Pipeline: Allow OrgBuilders to use these insights to fill blind spots in your hiring process and improve future outcomes.

### Set It Up in 10 seconds
1. Go to the Read AI integrations page (https://app.read.ai/analytics/integrations/user/workflow/webhooks)
2. Click "Add Webhook".
3. Set the name to Crossover Interview.
4. Set the URL to: https://interview-assist-api.crossover.com/readai-webhook/{{ graderId }}.

### Q&A
**Q:** How do interview summaries benefit me? \
**A:** These summaries are more than just notes—they’re actionable insights, created with your specific job requirements in mind. They include:
- Key interview questions and answers.
- Highlights of candidate achievements and skills.
- Profile match analysis: requirements met, gaps, and transferable skills.
- Strengths and concerns to consider.
- Suggestions for follow-up questions or areas to explore.
This isn’t just convenience—it’s a smarter, faster way to make confident hiring decisions.

**Q:** Where can I access the interview summaries? \
**A:** Summaries are:
- Available directly in the Job Application View on the Crossover platform.
- Delivered to your email immediately after each interview.

**Q:** How will OrgBuilders use this information? \
**A:** OrgBuilders use interview insights to identify critical skills or requirements that may not have surfaced earlier. These insights help refine your pipeline, ensuring a smoother hiring process and better candidates in the future.

**Q:** Will all my meetings be recorded by Crossover? \
**A:** No. While Read.ai notifies Crossover of all meetings, only those booked through your Calendly interview link are processed. Non-interview meetings are filtered out entirely.
`;
