import { Llm } from '@trilogy-group/xoh-integration';
import { DateTime } from 'luxon';
import { generateXMLFeed, Campaign } from '../../src/handlers/x-feed-generator';
import { generateText } from 'ai';
import { parseStringPromise } from 'xml2js';

jest.mock('ai', () => ({
  generateText: jest.fn(),
}));

describe('x-feed-generator', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (generateText as jest.Mock).mockResolvedValue({ text: 'Generated short description' });
    Llm.getDefaultModel = jest.fn().mockResolvedValue({});
  });

  it('should generate XML feed correctly', async () => {
    // Arrange
    const campaigns: Campaign[] = [
      {
        Id: '1',
        Name: 'Campaign 1',
        Type: 'Type 1',
        InternalId__c: 'InternalId_1',
        Ad_Title__c: 'Job Title 1',
        Description: 'Job Description 1',
        Pipeline__r: {
          Yearly_Rate__c: 100000,
          Last_Open_Date__c: '2023-01-01',
          Apply_URL__c: 'http://apply.url/1',
          LinkedIn_Experience_Level__c: 'Entry Level',
        },
      },
      {
        Id: '2',
        Name: 'Campaign 2',
        Type: 'Type 2',
        InternalId__c: 'InternalId_2',
        Ad_Title__c: 'Job Title 2',
        Description: 'Job Description 2',
        Pipeline__r: {
          Yearly_Rate__c: 120000,
          Last_Open_Date__c: '2023-02-01',
          Apply_URL__c: 'http://apply.url/2',
          LinkedIn_Experience_Level__c: 'Mid-Senior level',
        },
      },
      {
        Id: '3',
        Name: 'Campaign 3',
        Type: 'Type 3',
        InternalId__c: 'InternalId_3',
        Ad_Title__c: 'Job Title 3',
        Description: 'Job Description 3',
        Pipeline__r: {
          Yearly_Rate__c: 150000,
          Last_Open_Date__c: '2023-03-01',
          Apply_URL__c: 'http://apply.url/3',
          LinkedIn_Experience_Level__c: 'Director',
        },
      },
    ];

    // Act
    const xmlFeed = await generateXMLFeed(campaigns, 'companyId', 'companyName');

    // Assert
    const parsedXmlFeed = await parseStringPromise(xmlFeed);

    const expectedXmlFeed = {
      source: {
        job: [
          {
            partnerJobId: ['InternalId_1'],
            title: ['Job Title 1'],
            description: ['Job Description 1'],
            applyUrl: ['http://apply.url/1?utm_source=x&utm_medium=x_jobs&utm_campaign=InternalId_1'],
            companyId: ['companyId'],
            company: ['companyName'],
            shortDescription: ['<p>Generated short description</p>'],
            location: ['Remote'],
            workplaceType: ['remote'],
            experienceLevel: ['entry_level'],
            jobtype: ['full_time_contract'],
            salaries: [
              {
                salary: [
                  {
                    highEnd: ['100000'],
                    lowEnd: ['100000'],
                    period: ['year'],
                    currencyCode: ['USD'],
                  },
                ],
              },
            ],
            listDate: ['2023-01-01'],
          },
          {
            partnerJobId: ['InternalId_2'],
            title: ['Job Title 2'],
            description: ['Job Description 2'],
            applyUrl: ['http://apply.url/2?utm_source=x&utm_medium=x_jobs&utm_campaign=InternalId_2'],
            companyId: ['companyId'],
            company: ['companyName'],
            shortDescription: ['<p>Generated short description</p>'],
            location: ['Remote'],
            workplaceType: ['remote'],
            experienceLevel: ['mid_level'],
            jobtype: ['full_time_contract'],
            salaries: [
              {
                salary: [
                  {
                    highEnd: ['120000'],
                    lowEnd: ['120000'],
                    period: ['year'],
                    currencyCode: ['USD'],
                  },
                ],
              },
            ],
            listDate: ['2023-02-01'],
          },
          {
            partnerJobId: ['InternalId_3'],
            title: ['Job Title 3'],
            description: ['Job Description 3'],
            applyUrl: ['http://apply.url/3?utm_source=x&utm_medium=x_jobs&utm_campaign=InternalId_3'],
            companyId: ['companyId'],
            company: ['companyName'],
            shortDescription: ['<p>Generated short description</p>'],
            location: ['Remote'],
            workplaceType: ['remote'],
            experienceLevel: ['senior'],
            jobtype: ['full_time_contract'],
            salaries: [
              {
                salary: [
                  {
                    highEnd: ['150000'],
                    lowEnd: ['150000'],
                    period: ['year'],
                    currencyCode: ['USD'],
                  },
                ],
              },
            ],
            listDate: ['2023-03-01'],
          },
        ],
      },
    };

    expect(DateTime.fromFormat(parsedXmlFeed.source.lastBuildDate[0], 'yyyy-MM-dd HH:mm:ss').isValid).toBe(true);

    // Remove the lastBuildDate from the parsed XML feed for comparison
    delete parsedXmlFeed.source.lastBuildDate;

    expect(parsedXmlFeed).toEqual(expectedXmlFeed);
  });
});
