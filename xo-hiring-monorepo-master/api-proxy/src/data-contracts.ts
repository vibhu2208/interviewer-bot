import { z } from 'zod';

export const CandidateType = z
  .object({
    // Own editable profile
    Avatar__c: z.unknown().optional(),
    Description: z.unknown().optional(),
    Phone: z.unknown().optional(),
    Secondary_Email__c: z.unknown().optional(),
    Skype_Id__c: z.unknown().optional(),
    Timezone__c: z.unknown().optional(),
    Website: z.unknown().optional(),
    Preferred_Application__c: z.unknown().optional(),
    // The following fields are from Contact, also own editable profile
    PersonAssistantPhone: z.unknown().optional(),
    PersonHasOptedOutOfEmail: z.unknown().optional(),
    PersonHomePhone: z.unknown().optional(),
    PersonMailingAddress: z.unknown().optional(),
    PersonMobilePhone: z.unknown().optional(),
    PersonOtherPhone: z.unknown().optional(),
    PersonMailingCity: z.unknown().optional(),
    PersonMailingCountry: z.unknown().optional(),
  })
  .strict();

export const ApplicationType = z
  .object({
    StageName: z.literal('Canceled').optional(),
    Loss_Reason__c: z.unknown().optional(),
    Candidate_Cancel_Reason__c: z.unknown().optional(),
    CloseDate: z.unknown().optional(),
    // User can extend this. CloseDate is effectively used as a commitment date
    Commitment_Date__c: z.unknown().optional(),
    // Tracking stats
    Browser_Name__c: z.unknown().optional(),
    Browser_Version__c: z.unknown().optional(),
    Device_Model__c: z.unknown().optional(),
    Device_Type__c: z.unknown().optional(),
    Device_Vendor__c: z.unknown().optional(),
    Google_Client_ID__c: z.unknown().optional(),
    IP__c: z.unknown().optional(),
    OS_Name__c: z.unknown().optional(),
    OS_Version__c: z.unknown().optional(),
    Screen_Resolution__c: z.unknown().optional(),
    Screen_Resolution_Available__c: z.unknown().optional(),
    All_Traffic_Sources__c: z.unknown().optional(),
    Lead_Original_Campaign__c: z.unknown().optional(),
    Lead_Source_Campaign__c: z.unknown().optional(),
    gaconnector_Browser__c: z.unknown().optional(),
    gaconnector_City__c: z.unknown().optional(),
    gaconnector_Country__c: z.unknown().optional(),
    gaconnector_Device__c: z.unknown().optional(),
    gaconnector_First_Click_Campaign__c: z.unknown().optional(),
    gaconnector_First_Click_Channel__c: z.unknown().optional(),
    gaconnector_First_Click_Content__c: z.unknown().optional(),
    gaconnector_First_Click_Landing_Page__c: z.unknown().optional(),
    gaconnector_First_Click_Medium__c: z.unknown().optional(),
    gaconnector_First_Click_Referrer__c: z.unknown().optional(),
    gaconnector_First_Click_Source__c: z.unknown().optional(),
    gaconnector_First_Click_Term__c: z.unknown().optional(),
    gaconnector_Google_Analytics_Client_ID__c: z.unknown().optional(),
    gaconnector_IP_Address__c: z.unknown().optional(),
    gaconnector_Last_Click_Campaign__c: z.unknown().optional(),
    gaconnector_Last_Click_Channel__c: z.unknown().optional(),
    gaconnector_Last_Click_Content__c: z.unknown().optional(),
    gaconnector_Last_Click_Landing_Page__c: z.unknown().optional(),
    gaconnector_Last_Click_Medium__c: z.unknown().optional(),
    gaconnector_Last_Click_Referrer__c: z.unknown().optional(),
    gaconnector_Last_Click_Source__c: z.unknown().optional(),
    gaconnector_Last_Click_Term__c: z.unknown().optional(),
    gaconnector_Latitude_from_IP__c: z.unknown().optional(),
    gaconnector_Longitude__c: z.unknown().optional(),
    gaconnector_Number_of_Website_Visits__c: z.unknown().optional(),
    gaconnector_Operating_System__c: z.unknown().optional(),
    gaconnector_Pages_visited__c: z.unknown().optional(),
    gaconnector_Time_Spent_on_Website__c: z.unknown().optional(),
    gaconnector_Time_Zone__c: z.unknown().optional(),
  })
  .strict();

export const AsrType = z
  .object({
    // Start
    GA_Client_Start_ID__c: z.unknown().optional(),
    Started_At_Time__c: z.unknown().optional(),
    Step_Start_IP__c: z.unknown().optional(),
    // Stop
    Step_Complete_IP__c: z.unknown().optional(),
    GA_Client_Complete_ID__c: z.unknown().optional(),
    // Direct manipulations
    Badge_Hidden__c: z.unknown().optional(),
  })
  .strict();

export const InfoType = z
  .object({
    Associated_with__c: z.unknown().optional(),
    Candidate__c: z.unknown().optional(),
    Degree__c: z.unknown().optional(),
    Description__c: z.unknown().optional(),
    Employment_Type__c: z.unknown().optional(),
    End_Date_Accurate__c: z.unknown().optional(),
    End_Date__c: z.unknown().optional(),
    End_Month_Accurate__c: z.unknown().optional(),
    ExternalId__c: z.unknown().optional(),
    Grade__c: z.unknown().optional(),
    Institution__c: z.unknown().optional(),
    Name: z.unknown().optional(),
    Ongoing__c: z.unknown().optional(),
    Patent_State__c: z.unknown().optional(),
    RecordTypeId: z.unknown().optional(),
    Start_Date_Accurate__c: z.unknown().optional(),
    Start_Date__c: z.unknown().optional(),
    Start_Month_Accurate__c: z.unknown().optional(),
    URL__c: z.unknown().optional(),
    What__c: z.unknown().optional(),
  })
  .strict();

export const CaseType = z
  .object({
    AccountId: z.unknown().optional(),
    Application__c: z.unknown().optional(),
    Category__c: z.unknown().optional(),
    Description: z.unknown().optional(),
    Subject: z.unknown().optional(),
    Status: z.unknown().optional(),
    Origin: z.unknown().optional(),
    ContactId: z.unknown().optional(),
    OwnerId: z.unknown().optional(),
    Application_Stage__c: z.unknown().optional(),
    IP__c: z.unknown().optional(),
    Browser_Name__c: z.unknown().optional(),
    Browser_Version__c: z.unknown().optional(),
    Device_Model__c: z.unknown().optional(),
    Device_Type__c: z.unknown().optional(),
    Device_Vendor__c: z.unknown().optional(),
    OS_Name__c: z.unknown().optional(),
    OS_Version__c: z.unknown().optional(),
    Screen_Resolution__c: z.unknown().optional(),
    Screen_Resolution_Available__c: z.unknown().optional(),
    Pipeline__c: z.unknown().optional(),
    Pipeline_Manager__c: z.unknown().optional(),
  })
  .strict();

export const ApplyWithoutCandidateIdType = z.object({
  inputs: z.array(z.object({ iVarT_CandidateId: z.never().optional() })),
});
