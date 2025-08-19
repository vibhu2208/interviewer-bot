import { IndeedDataService } from '../../src/services/indeed-data-service';
import { mockCampaign } from '../services/indeed-data-service.test';
import { EventPayload, handler } from '../../src/handlers/indeed-feed-generator';
import { Salesforce } from '@trilogy-group/xoh-integration';
import { FeedUploadService } from '../../src/services/feed-upload-service';

const XmlFeedExample = `
<?xml version="1.0" encoding="UTF-8"?>
<source>
  <publisher>Crossover</publisher>
  <publisherurl>https://www.crossover.com</publisherurl>
  <job>
    <title><![CDATA[Software Engineer II]]></title>
    <date><![CDATA[2023-01-01]]></date>
    <referencenumber><![CDATA[Campaign 1]]></referencenumber>
    <requisitionid><![CDATA[Campaign 1]]></requisitionid>
    <url><![CDATA[https://www.crossover.com/jobs/software-engineer-ii?utm_source=indeed&utm_medium=free&utm_campaign=InternalId_1]]></url>
    <applyurl><![CDATA[https://www.crossover.com/jobs/software-engineer-ii/apply?utm_source=indeed&utm_medium=free&utm_campaign=InternalId_1]]></applyurl>
    <salary><![CDATA[60000 USD per year]]></salary>
    <company><![CDATA[Crossover]]></company>
    <sourcename><![CDATA[Crossover]]></sourcename>
    <city><![CDATA[remote]]></city>
    <state><![CDATA[remote]]></state>
    <country/>
    <contact><![CDATA[Dragos Nuta]]></contact>
    <email><![CDATA[dragos.nuta@crossover.com]]></email>
    <description><![CDATA[Description]]></description>
    <jobtype><![CDATA[parttime]]></jobtype>
    <category><![CDATA[I2_PIPE_1234_SouthAsia]]></category>
    <remotetype><![CDATA[Fully remote]]></remotetype>
    <indeed-apply-data><![CDATA[indeed-apply-apiToken=id&indeed-apply-resume=optional&indeed-apply-coverletter=hidden&indeed-apply-jobTitle=Software+Engineer+II&indeed-apply-jobCompanyName=Crossover&indeed-apply-jobLocation=&indeed-apply-jobId=InternalId_1&indeed-apply-name=firstlastname&indeed-apply-questions=url&indeed-apply-postUrl=url&indeed-apply-jobUrl=https%3A%2F%2Fwww.crossover.com%2Fjobs%2Fsoftware-engineer-ii%3Futm_source%3Dindeed%26utm_medium%3Dfree%26utm_campaign%3DInternalId_1]]></indeed-apply-data>
  </job>
  <job>
    <title><![CDATA[Software Engineer II]]></title>
    <date><![CDATA[2023-01-01]]></date>
    <referencenumber><![CDATA[Campaign 1]]></referencenumber>
    <requisitionid><![CDATA[Campaign 1]]></requisitionid>
    <url><![CDATA[https://www.crossover.com/jobs/software-engineer-ii?utm_source=indeed&utm_medium=free&utm_campaign=InternalId_1]]></url>
    <applyurl><![CDATA[https://www.crossover.com/jobs/software-engineer-ii/apply?utm_source=indeed&utm_medium=free&utm_campaign=InternalId_1]]></applyurl>
    <salary><![CDATA[60000 USD per year]]></salary>
    <company><![CDATA[Crossover]]></company>
    <sourcename><![CDATA[Crossover]]></sourcename>
    <city><![CDATA[remote]]></city>
    <state><![CDATA[remote]]></state>
    <country/>
    <contact><![CDATA[Dragos Nuta]]></contact>
    <email><![CDATA[dragos.nuta@crossover.com]]></email>
    <description><![CDATA[Description]]></description>
    <jobtype><![CDATA[parttime]]></jobtype>
    <category><![CDATA[I2_PIPE_1234_SouthAsia]]></category>
    <remotetype><![CDATA[Fully remote]]></remotetype>
    <indeed-apply-data><![CDATA[indeed-apply-apiToken=id&indeed-apply-resume=optional&indeed-apply-coverletter=hidden&indeed-apply-jobTitle=Software+Engineer+II&indeed-apply-jobCompanyName=Crossover&indeed-apply-jobLocation=&indeed-apply-jobId=InternalId_1&indeed-apply-name=firstlastname&indeed-apply-questions=url&indeed-apply-postUrl=url&indeed-apply-jobUrl=https%3A%2F%2Fwww.crossover.com%2Fjobs%2Fsoftware-engineer-ii%3Futm_source%3Dindeed%26utm_medium%3Dfree%26utm_campaign%3DInternalId_1]]></indeed-apply-data>
  </job>
</source>
`.trim();

describe('IndeedFeedGeneratorHandler', () => {
  it('should process event and update campaign placements', async () => {
    // Arrange
    const mockEvent: EventPayload = {
      Currency: 'USDCode',
      SalaryTimeUnit: 'year',
      IndeedApplyResumeTag: 'optional',
      ListAllAdsUnderCrossover: true,
      PostCellAdsAsRemote: true,
      PostCountryCellsAsRemote: true,
      UseTwoLetterCountryCode: true,
      EnableIndeedApply: true,
    };

    const mockCampaigns = [
      mockCampaign({ level: 'Country', value: 'India' }, { country: 'India', globalRegion: 'SouthAsia' }),
      mockCampaign({ level: 'Country', value: 'India' }, { country: 'India', globalRegion: 'SouthAsia' }),
    ];

    const mockSFClient = {
      querySOQL: jest.fn().mockResolvedValue([]),
    };

    Salesforce.getAdminClient = jest.fn().mockResolvedValue(mockSFClient);
    IndeedDataService.getConfig = jest.fn().mockResolvedValue({
      IndeedSecrets: {
        indeedClientId: 'id',
        indeedClientSecret: 'secret',
        indeedPostUrl: 'url',
        indeedQuestionsUrl: 'url',
      },
      Currency: 'USDCode',
      SalaryTimeUnit: 'year',
      ListAllAdsUnderCrossover: true,
      PostCellAdsAsRemote: true,
      PostCountryCellsAsRemote: true,
      UseTwoLetterCountryCode: true,
      EnableIndeedApply: true,
      IndeedApplyResumeTag: 'optional',
    });

    IndeedDataService.fetchCountries = jest.fn().mockResolvedValue([]);
    IndeedDataService.fetchCampaigns = jest.fn().mockResolvedValue(mockCampaigns);
    FeedUploadService.uploadXMLToS3Bucket = jest.fn();
    IndeedDataService.updateCampaignPlacement = jest.fn();

    // Act
    await handler(mockEvent);

    // Assert
    expect(IndeedDataService.getConfig).toHaveBeenCalledWith(mockEvent);
    expect(IndeedDataService.fetchCountries).toHaveBeenCalledWith(mockSFClient);
    expect(IndeedDataService.fetchCampaigns).toHaveBeenCalledWith(mockSFClient);
    expect(FeedUploadService.uploadXMLToS3Bucket).toHaveBeenCalledTimes(1);
    expect(IndeedDataService.updateCampaignPlacement).toHaveBeenCalledWith(mockSFClient, mockCampaigns);

    const xmlFeed = (FeedUploadService.uploadXMLToS3Bucket as jest.Mock).mock.calls[0][1];
    expect(xmlFeed).toEqual(XmlFeedExample);
  });
});
