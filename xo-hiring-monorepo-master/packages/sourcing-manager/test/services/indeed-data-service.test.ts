import {
  IndeedCampaignEx,
  IndeedCampaignPlacementObject,
  IndeedDataService,
} from '../../src/services/indeed-data-service';
import { IndeedCampaign, CampaignPlacementConfiguration } from '../../src/services/indeed-data-service';

describe('IndeedDataService.determineCampaignPlacement', () => {
  it('should group campaigns by CountryDivision/Country and assign/discard placement', () => {
    const testConfig: CampaignPlacementConfiguration = {
      campaignsPerSponsoringCampaign: {
        min: 3,
        max: 5,
      },
    };

    // 6 campaigns from the same country division split into 2 equals country-division groups
    // The rest 2 campaigns from the other division and one country-level campaign are all part of the same country-level group
    // 2 campaigns from Pakistan are discarded (different country with < min campaigns)
    const mockCampaigns: IndeedCampaign[] = [
      mockCampaign(
        { level: 'CountryDivision', value: 'IndiaNorth_1' },
        { country: 'India', countryDivision: 'IndiaNorth' },
      ),
      mockCampaign(
        { level: 'CountryDivision', value: 'IndiaNorth_1' },
        { country: 'India', countryDivision: 'IndiaNorth' },
      ),
      mockCampaign(
        { level: 'CountryDivision', value: 'IndiaNorth_1' },
        { country: 'India', countryDivision: 'IndiaNorth' },
      ),
      mockCampaign(
        { level: 'CountryDivision', value: 'IndiaNorth_2' },
        { country: 'India', countryDivision: 'IndiaNorth' },
      ),
      mockCampaign(
        { level: 'CountryDivision', value: 'IndiaNorth_2' },
        { country: 'India', countryDivision: 'IndiaNorth' },
      ),
      mockCampaign(
        { level: 'CountryDivision', value: 'IndiaNorth_2' },
        { country: 'India', countryDivision: 'IndiaNorth' },
      ),
      mockCampaign({ level: 'Country', value: 'India' }, { country: 'India', countryDivision: 'IndiaSouth' }),
      mockCampaign({ level: 'Country', value: 'India' }, { country: 'India', countryDivision: 'IndiaSouth' }),
      mockCampaign({ level: 'Country', value: 'India' }, { country: 'India', countryDivision: null }),
      mockCampaign({ level: 'None', value: 'Discard' }, { country: 'Pakistan', countryDivision: null }),
      mockCampaign({ level: 'None', value: 'Discard' }, { country: 'Pakistan', countryDivision: null }),
    ];

    const result = IndeedDataService.determineCampaignPlacement(mockCampaigns, testConfig);

    for (const campaign of result) {
      assertPlacement(campaign);
    }
  });

  it('should group campaigns by Country/GlobalRegion and discard/assign placement', () => {
    const testConfig: CampaignPlacementConfiguration = {
      campaignsPerSponsoringCampaign: {
        min: 2,
        max: 3,
      },
    };

    // 3 India campaigns are part of the same country-level group
    // 4 EU country campaigns are grouped into 2 global-region groups
    // 1 Madagascar campaign is discarded (different global region with < min campaigns)
    const mockCampaigns: IndeedCampaign[] = [
      mockCampaign({ level: 'Country', value: 'India' }, { country: 'India', globalRegion: 'SouthAsia' }),
      mockCampaign({ level: 'Country', value: 'India' }, { country: 'India', globalRegion: 'SouthAsia' }),
      mockCampaign({ level: 'Country', value: 'India' }, { country: 'India', globalRegion: 'SouthAsia' }),
      mockCampaign(
        { level: 'GlobalRegion', value: 'EuropeAndCentralAsia' },
        { country: 'Slovakia', globalRegion: 'EuropeAndCentralAsia' },
      ),
      mockCampaign(
        { level: 'Country', value: 'Switzerland' },
        { country: 'Switzerland', globalRegion: 'EuropeAndCentralAsia' },
      ),
      mockCampaign(
        { level: 'Country', value: 'Switzerland' },
        { country: 'Switzerland', globalRegion: 'EuropeAndCentralAsia' },
      ),
      mockCampaign(
        { level: 'GlobalRegion', value: 'EuropeAndCentralAsia' },
        { country: 'Italy', globalRegion: 'EuropeAndCentralAsia' },
      ),
      mockCampaign({ level: 'None', value: 'Discard' }, { country: 'Madagascar', globalRegion: 'SubSaharanAfrica' }),
    ];

    const result = IndeedDataService.determineCampaignPlacement(mockCampaigns, testConfig);

    for (const campaign of result) {
      assertPlacement(campaign);
    }
  });

  it('should group campaigns for different product codes separately', () => {
    const testConfig: CampaignPlacementConfiguration = {
      campaignsPerSponsoringCampaign: {
        min: 2,
        max: 3,
      },
    };

    // There will be no group-splitting, because every product code has only 2 campaigns
    const mockCampaigns: IndeedCampaign[] = [
      mockCampaign({ level: 'Country', value: 'India' }, { country: 'India', globalRegion: 'SouthAsia', code: '1234' }),
      mockCampaign({ level: 'Country', value: 'India' }, { country: 'India', globalRegion: 'SouthAsia', code: '1234' }),
      mockCampaign({ level: 'Country', value: 'India' }, { country: 'India', globalRegion: 'SouthAsia', code: '4321' }),
      mockCampaign({ level: 'Country', value: 'India' }, { country: 'India', globalRegion: 'SouthAsia', code: '4321' }),
    ];

    const result = IndeedDataService.determineCampaignPlacement(mockCampaigns, testConfig);

    for (const campaign of result) {
      assertPlacement(campaign);
    }
  });
});

describe('IndeedDataService.generateCampaignCategoryTag', () => {
  it('should generate category tags and update placement', () => {
    // level and value are real placement parameters, tag is an expected generated value
    const mockCampaigns: IndeedCampaignEx[] = [
      mockCampaign({ level: 'Country', value: 'India', tag: 'I2_PIPE_1234_India' }, { code: '1234' }),
      mockCampaign({ level: 'Country', value: 'India', tag: 'I2_PIPE_1234_India' }, { code: '1234' }),
      mockCampaign(
        { level: 'GlobalRegion', value: 'EastAsiaAndPacific', tag: 'I2_PIPE_1234_EastAsiaAndPacific' },
        { code: '1234' },
      ),
      mockCampaign(
        { level: 'GlobalRegion', value: 'EuropeAndCentralAsia', tag: 'I2_PIPE_1234_EuropeAndCentralAsia' },
        { code: '1234' },
      ),
      mockCampaign({ level: 'None', value: 'Discard', tag: undefined }, { code: '1234' }),
      mockCampaign({ level: 'Country', value: 'India', tag: 'I2_PIPE_4321_India' }, { code: '4321' }),
      mockCampaign({ level: 'Country', value: 'India', tag: 'I2_PIPE_4321_India' }, { code: '4321' }),
    ];

    // Emulating the determineCampaignPlacement output - setting the placement based on the expected value, but not the tag
    mockCampaigns.forEach(
      (it) => (it.Placement = { level: it.ExpectedPlacement?.level, value: it.ExpectedPlacement?.value } as any),
    );
    mockCampaigns.forEach((it) => (it.Placement__c = JSON.stringify(it.Placement)));

    IndeedDataService.generateCampaignCategoryTag(mockCampaigns);

    for (const campaign of mockCampaigns) {
      assertPlacement(campaign);
      if (campaign.ExpectedPlacement?.tag) {
        expect(campaign.Placement__c).toContain(campaign.ExpectedPlacement?.tag);
      }
    }
  });
});

export function mockCampaign(
  expectedPlacement: IndeedCampaignPlacementObject,
  override?: {
    code?: string;
    countryDivision?: string | null;
    country?: string;
    globalRegion?: string;
  },
  campaignId = 1,
): IndeedCampaignEx {
  return {
    Id: `${campaignId}`,
    Name: `Campaign ${campaignId}`,
    Type: 'Hire pipeline',
    InternalId__c: `InternalId_${campaignId}`,
    Ad_Title__c: `Software Engineer II`,
    Description: `Description`,
    Ad_Posted_Country_Name__c: 'Pakistan',
    Ad_Posted_Location_Name__c: null,
    Pipeline__r: {
      Name: 'Software Engineer II',
      ProductCode: override?.code ?? '1234',
      Brand__r: { Name: 'Crossover' },
      CreatedDate: '2023-01-01',
      Geographic_Restriction__c: 'None',
      Hourly_Rate__c: 30,
      Yearly_Rate__c: 60000,
      Monthly_Rate__c: 4800,
      Job_Type__c: 'Full-Time',
      Hours_per_Week__c: 40,
      Family: 'engineering',
      Sourcing_World_Map__c: 'XXX',
    },
    Job_Board_Cell__r: {
      Location__r: {
        Is_Country__c: true,
        Country_Division__c: override?.countryDivision ?? null,
        Global_Region__c: override?.globalRegion ?? 'SouthAsia',
        Country__c: override?.country ?? 'Pakistan',
      },
      Pipeline_Job_Title__r: {
        Landing_Page_URL__c: 'https://www.crossover.com/jobs/software-engineer-ii',
        Apply_URL__c: 'https://www.crossover.com/jobs/software-engineer-ii/apply',
      },
      Location__c: 'YYY',
    },
    Job_Board_Cell__c: 'FFF',
    Placement__c: null,
    ExpectedPlacement: expectedPlacement,
  };
}

function assertPlacement(campaign: IndeedCampaignEx, placement?: IndeedCampaignPlacementObject) {
  const expectedPlacement = placement ?? campaign.ExpectedPlacement;
  const realPlacement = campaign.Placement__c ? JSON.parse(campaign.Placement__c) : null;
  expect(realPlacement).toEqual(expectedPlacement);
}
