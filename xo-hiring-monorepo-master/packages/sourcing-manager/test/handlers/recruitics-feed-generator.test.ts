import { handler } from '../../src/handlers/recruitics-feed-generator';
import { FeedUploadService } from '../../src/services/feed-upload-service';
import * as utils from '../../src/services/recruitics-data-service';
import * as data from '../../src/services/recruitics-data-service';

jest.spyOn(utils, 'getConfig').mockImplementation(jest.fn());
jest.spyOn(data, 'getCountries').mockImplementation(jest.fn());
jest.spyOn(data, 'getCampaigns').mockImplementation(jest.fn());
FeedUploadService.uploadXMLToS3Bucket = jest.fn();

describe('handler function', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should generate and upload XML successfully', async () => {
    const mockConfig = {
      Secrets: {},
      Currency: 'LocalPlain',
      SalaryTimeUnit: 'Year',
      ListAllAdsUnderCrossover: true,
      PostCellAdsAsRemote: false,
      PostCountryCellsAsRemote: true,
      UseTwoLetterCountryCode: false,
    };

    const mockCountries = [
      { Label: 'France', Code__c: 'FR', Currency__c: 'EUR', Exchange_Rate__c: 1, Currency_Symbol__c: '€' },
    ];

    const mockCampaigns = [
      {
        Ad_Title__c: 'Software Engineer',
        InternalId__c: 'SE-001',
        Ad_Posted_Country_Name__c: 'France',
        Ad_Posted_Location_Name__c: 'Paris',
        Job_Board_Cell__r: {
          Location__r: { Is_Country__c: false },
          Pipeline_Job_Title__r: {
            Landing_Page_URL__c: 'https://www.example.com/job/software-engineer',
            Apply_URL__c: 'https://www.example.com/apply/software-engineer',
          },
        },
        Pipeline__r: {
          CreatedDate: '2023-04-01T00:00:00Z',
          Monthly_Rate__c: 8000,
          Yearly_Rate__c: 96000,
          Brand__r: { Name: 'ExampleCorp' },
          Job_Type__c: 'full-time',
          ProductCode: 'ENG',
          Geographic_Restriction__c: 'City',
        },
        Description: 'Job description here',
      },
    ];

    (utils.getConfig as jest.Mock).mockResolvedValue(mockConfig);
    (data.getCountries as jest.Mock).mockResolvedValue(mockCountries);
    (data.getCampaigns as jest.Mock).mockResolvedValue(mockCampaigns);
    (FeedUploadService.uploadXMLToS3Bucket as jest.Mock).mockResolvedValue(undefined);

    await handler({});

    expect(utils.getConfig).toHaveBeenCalled();
    expect(data.getCountries).toHaveBeenCalled();
    expect(data.getCampaigns).toHaveBeenCalled();
    expect(FeedUploadService.uploadXMLToS3Bucket).toHaveBeenCalled();
  });
});
