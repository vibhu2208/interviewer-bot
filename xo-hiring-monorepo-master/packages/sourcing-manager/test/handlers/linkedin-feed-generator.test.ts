import {
  generateLinkedInXMLFeed,
  buildLinkedInJobFeedXml,
  FeedGenerationData,
} from '../../src/handlers/linkedin-feed-generator';
import { LinkedInCampaign, LinkedInDataService } from '../../src/services/linkedin-data-service';
import { Salesforce } from '@trilogy-group/xoh-integration';
import { FeedUploadService } from '../../src/services/feed-upload-service';

// Mock external dependencies
jest.mock('@trilogy-group/xoh-integration', () => ({
  Salesforce: {
    getAdminClient: jest.fn(),
  },
  SalesforceIntegrationLogger: {
    setLogLevel: jest.fn(),
  },
  defaultLogger: jest.fn().mockReturnValue({
    info: jest.fn(),
    error: jest.fn(),
  }),
}));
jest.mock('../../src/services/feed-upload-service');
jest.mock('luxon', () => {
  const originalLuxon = jest.requireActual('luxon');
  return {
    ...originalLuxon,
    DateTime: {
      ...originalLuxon.DateTime,
      now: jest.fn(() => originalLuxon.DateTime.fromISO('2024-12-24T00:10:00', { zone: 'utc' })),
    },
  };
});

describe('LinkedInFeedGenerator', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should generate a valid LinkedIn feed and upload it', async () => {
    // Arrange mock data
    const mockLinkedInConfig = {
      Master_Brand_Id__c: 'brand123',
    };
    const mockCampaigns = [
      {
        Id: 'campaign1',
        InternalId__c: 'internalId1',
        Ad_Title__c: 'Job Title 1',
        Description: 'Job description 1',
        Pipeline__r: {
          Brand__r: {
            Name: 'Brand Name 1',
            LinkedIn_Company_ID__c: '12345',
          },
        },
      },
      {
        Id: 'campaign2',
        InternalId__c: 'internalId2',
        Ad_Title__c: 'Job Title 2',
        Description: 'Job description 2',
        Pipeline__r: {
          Brand__r: {
            Name: 'Brand Name 2',
            LinkedIn_Company_ID__c: '67890',
          },
        },
      },
    ];
    const mockMasterBrand = {
      Name: 'Master Brand',
      LinkedIn_Company_ID__c: 'masterBrandId',
    };
    const mockCountries = [{ Label: 'US', Code: 'US' }];

    // Mock Salesforce client and LinkedInDataService responses
    (Salesforce.getAdminClient as jest.Mock).mockResolvedValue('mockSalesforceClient');
    LinkedInDataService.getConfig = jest.fn().mockResolvedValue(mockLinkedInConfig);
    LinkedInDataService.fetchCampaigns = jest.fn().mockResolvedValue(mockCampaigns);
    LinkedInDataService.fetchMasterBrand = jest.fn().mockResolvedValue(mockMasterBrand);
    LinkedInDataService.fetchCountries = jest.fn().mockResolvedValue(mockCountries);
    (FeedUploadService.uploadXMLToS3Bucket as jest.Mock).mockResolvedValue(undefined);

    // Act
    await generateLinkedInXMLFeed();

    // Assert
    expect(Salesforce.getAdminClient).toHaveBeenCalled();
    expect(LinkedInDataService.getConfig).toHaveBeenCalledWith('mockSalesforceClient');
    expect(LinkedInDataService.fetchCampaigns).toHaveBeenCalledWith('mockSalesforceClient');
    expect(LinkedInDataService.fetchMasterBrand).toHaveBeenCalledWith(
      'mockSalesforceClient',
      mockLinkedInConfig.Master_Brand_Id__c,
    );
    expect(LinkedInDataService.fetchCountries).toHaveBeenCalledWith('mockSalesforceClient');
    expect(FeedUploadService.uploadXMLToS3Bucket).toHaveBeenCalledWith(
      'linkedin/linkedin-jobs-feed.xml',
      expect.any(String), // XML content
    );
  });

  it('should handle campaigns with missing required fields gracefully', async () => {
    // Arrange mock data
    const mockLinkedInConfig = {
      Master_Brand_Id__c: 'brand123',
    };
    const mockInvalidCampaigns = [
      {
        Id: 'campaign1',
        InternalId__c: 'internalId1',
        Ad_Title__c: null, // Missing Title
        Description: 'Job description 1',
        Pipeline__r: {
          Brand__r: {
            Name: 'Brand Name 1',
            LinkedIn_Company_ID__c: '12345',
          },
        },
      },
    ];
    const mockMasterBrand = {
      Name: 'Master Brand',
      LinkedIn_Company_ID__c: 'masterBrandId',
    };
    const mockCountries = [{ Label: 'US', Code: 'US' }];

    // Mock Salesforce client and LinkedInDataService responses
    (Salesforce.getAdminClient as jest.Mock).mockResolvedValue('mockSalesforceClient');
    LinkedInDataService.getConfig = jest.fn().mockResolvedValue(mockLinkedInConfig);
    LinkedInDataService.fetchCampaigns = jest.fn().mockResolvedValue(mockInvalidCampaigns);
    LinkedInDataService.fetchMasterBrand = jest.fn().mockResolvedValue(mockMasterBrand);
    LinkedInDataService.fetchCountries = jest.fn().mockResolvedValue(mockCountries);

    // Act
    await generateLinkedInXMLFeed();

    // Assert
    // The invalid campaign should have been skipped, so no XML should be written
    expect(FeedUploadService.uploadXMLToS3Bucket).toHaveBeenCalledWith(
      expect.any(String),
      `
<?xml version="1.0" encoding="UTF-8"?>
<source>
  <lastBuildDate>Tue, 24 Dec 2024 00:10:00 +0000</lastBuildDate>
</source>`.trim(),
    );
  });

  it('should build valid XML for LinkedIn campaigns', () => {
    // Arrange
    const mockCampaigns = [
      {
        Id: '701Ij0000015v3tIAA',
        Type: 'LinkedIn Job Slots',
        InternalId__c: 'LJ-5473-US-Houston-BootcampOperat',
        Ad_Title__c: 'Bootcamp Operations Manager, Trilogy - $100,000/year USD',
        Description: 'Test Description',
        LI_Ad_Job_Functions__c: 'Administrative;Operations;Program and Project Management',
        LI_Ad_Industries__c: 'Education Management;Events Services;Professional Training & Coaching',
        LI_Ad_Experience_Level__c: 'Mid-Senior level',
        LI_Ad_Skills__c: 'Java, SQL, AI',
        Ad_Posted_Country_Name__c: 'United States',
        Ad_Posted_Location_Name__c: 'Houston',
        Ad_OneClick_Apply__c: 'Yes',
        Pipeline__r: {
          Name: 'Gauntlet Program Operations Manager',
          ProductCode: '5473',
          Geographic_Restriction__c: 'City',
          Hourly_Rate__c: 50,
          Brand__r: {
            Name: 'Trilogy',
            LinkedIn_Company_ID__c: 3607,
          },
          Job_Type__c: 'full-time',
        },
        Job_Board_Cell__r: {
          Pipeline_Job_Title__r: {
            Apply_URL__c: 'https://www.crossover.com/roles/a0sIj0000016BusIAE/bootcamp-operations-manager/apply',
          },
          Location__r: {
            City_Name__c: 'Houston',
            Is_Country__c: false,
            Country__c: 'United States',
            State_Name__c: 'Texas',
          },
        },
      },
    ] as LinkedInCampaign[];
    const mockFeedData = {
      config: {
        LinkedIn_Job_Tag_Free_Listing__c: '#LI-NS',
        LinkedIn_Job_Tag_Slot__c: '#LI-DN1',
        Master_Brand_Id__c: 'a0x0o00000QWJWMAA5',
      },
      countries: [{ Label: 'United States', Code__c: 'US' }],
      masterBrand: {
        Name: 'Trilogy',
        LinkedIn_Company_ID__c: 3607,
      },
    } as unknown as FeedGenerationData;

    // Act
    const xml = buildLinkedInJobFeedXml(mockCampaigns, mockFeedData);

    // Assert
    expect(xml.trim()).toEqual(
      `
<?xml version="1.0" encoding="UTF-8"?>
<source>
  <lastBuildDate>Tue, 24 Dec 2024 00:10:00 +0000</lastBuildDate>
  <job>
    <partnerJobId><![CDATA[LJ-5473-US-Houston-BootcampOperat]]></partnerJobId>
    <company><![CDATA[Trilogy]]></company>
    <companyId><![CDATA[3607]]></companyId>
    <title><![CDATA[Bootcamp Operations Manager, Trilogy - $100,000/year USD]]></title>
    <description><![CDATA[Test Description
Crossover Job Code: LJ-5473-US-Houston-BootcampOperat<br/>
#LI-DN1<br />
]]></description>
    <experienceLevel><![CDATA[MID_SENIOR_LEVEL]]></experienceLevel>
    <jobtype><![CDATA[FULL_TIME]]></jobtype>
    <country><![CDATA[US]]></country>
    <city><![CDATA[Houston]]></city>
    <state><![CDATA[Texas]]></state>
    <jobFunctions>
      <jobFunction><![CDATA[adm]]></jobFunction>
      <jobFunction><![CDATA[eng]]></jobFunction>
      <jobFunction><![CDATA[prjm]]></jobFunction>
    </jobFunctions>
    <industryCodes>
      <industryCode><![CDATA[69]]></industryCode>
      <industryCode><![CDATA[110]]></industryCode>
      <industryCode><![CDATA[105]]></industryCode>
    </industryCodes>
    <skills>
      <skill><![CDATA[Java]]></skill>
      <skill><![CDATA[SQL]]></skill>
      <skill><![CDATA[AI]]></skill>
    </skills>
    <salaries>
      <salary>
        <highEnd>
          <amount><![CDATA[50]]></amount>
          <currencyCode>USD</currencyCode>
        </highEnd>
        <lowEnd>
          <amount><![CDATA[50]]></amount>
          <currencyCode>USD</currencyCode>
        </lowEnd>
        <period><![CDATA[HOURLY]]></period>
        <type><![CDATA[BASE_SALARY]]></type>
      </salary>
    </salaries>
    <applyUrl><![CDATA[https://www.crossover.com/roles/a0sIj0000016BusIAE/bootcamp-operations-manager/apply?utm_source=linkedin&utm_medium=jobslot&utm_campaign=LJ-5473-US-Houston-BootcampOperat]]></applyUrl>
    <easyapply/>
  </job>
</source>
    `.trim(),
    );
  });
});
