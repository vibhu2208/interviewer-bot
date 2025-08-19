import { SalesforceClient } from '@trilogy-group/xoh-integration';
import { IndeedCountry } from './indeed-data-service';

export interface LinkedInConfiguration {
  LinkedIn_Job_Tag_Free_Listing__c: string;
  LinkedIn_Job_Tag_Slot__c: string;
  Master_Brand_Id__c: string;
}

export interface LinkedInCampaign {
  Id: string;
  InternalId__c: string;
  Type: string;
  Ad_Title__c: string;
  Description: string;
  Ad_OneClick_Apply__c: string;
  LI_Ad_Job_Functions__c: string;
  LI_Ad_Industries__c: string;
  LI_Ad_Experience_Level__c: string;
  LI_Ad_Skills__c: string;
  Ad_Posted_Country_Name__c: string;
  Ad_Posted_Location_Name__c: string;
  Pipeline__r: {
    Name: string;
    ProductCode: string;
    Brand__r: {
      Name: string;
      LinkedIn_Company_ID__c: number;
    };
    Geographic_Restriction__c: string;
    Hourly_Rate__c: number;
    Job_Type__c: string;
  };
  Job_Board_Cell__r: {
    Pipeline_Job_Title__r: {
      Apply_URL__c: string;
    };
    Location__r: {
      Is_Country__c: boolean;
      City_Name__c: string;
      Country__c: string;
      State_Name__c: string;
    };
  };
}

export interface LinkedInBrand {
  Name: string;
  LinkedIn_Company_ID__c: string;
}

export const LinkedInExperienceLevel: Record<string, string> = {
  'Not Applicable': 'NOT_APPLICABLE',
  Internship: 'INTERNSHIP',
  'Entry level': 'ENTRY_LEVEL',
  Associate: 'ASSOCIATE',
  'Mid-Senior level': 'MID_SENIOR_LEVEL',
  Director: 'DIRECTOR',
  Executive: 'EXECUTIVE',
};

export const LinkedInJobType: Record<string, string> = {
  'full-time': 'FULL_TIME',
  'part-time': 'PART_TIME',
  contractor: 'CONTRACT',
};

export const enum LinkedInWorkplaceType {
  OnSite = 'On-site',
  Hybrid = 'Hybrid',
  Remote = 'Remote',
}

export const LinkedInJobFunctions: Record<string, string> = {
  'Accounting / Auditing': 'acct',
  Accounting: 'acct',
  Administrative: 'adm',
  Advertising: 'advr',
  Analyst: 'anls',
  'Art / Creative': 'art',
  'Arts and Design': 'art',
  'Business Development': 'bd',
  Consulting: 'cnsl',
  'Customer Service': 'cust',
  Support: 'cust',
  Distribution: 'dist',
  Design: 'dsgn',
  Education: 'edu',
  Engineering: 'eng',
  Operations: 'eng',
  Finance: 'fin',
  'General Business': 'genb',
  'Health Care Provider': 'hcpr',
  'Human Resources': 'hr',
  'Information Technology': 'it',
  Legal: 'lgl',
  Management: 'mgmt',
  Manufacturing: 'mnfc',
  Marketing: 'mrkt',
  'Media and Communication': 'mrkt',
  Other: 'othr',
  'Public Relations': 'pr',
  Purchasing: 'prch',
  'Product Management': 'prdm',
  'Project Management': 'prjm',
  'Program and Project Management': 'prjm',
  Production: 'prod',
  'Quality Assurance': 'qa',
  Research: 'rsch',
  Sales: 'sale',
  Science: 'sci',
  'Strategy / Planning': 'stra',
  'Supply Chain': 'supl',
  Training: 'trng',
  'Writing / Editing': 'wrt',
};

export const LinkedInIndustries: Record<string, string> = {
  'Defense & Space': '1',
  '(deprecated #2)': '2',
  'Computer Hardware': '3',
  'Computer Software': '4',
  'Computer Networking': '5',
  Internet: '6',
  Semiconductors: '7',
  Telecommunications: '8',
  'Law Practice': '9',
  'Legal Services': '10',
  'Management Consulting': '11',
  Biotechnology: '12',
  'Medical Practice': '13',
  'Hospital & Health Care': '14',
  Pharmaceuticals: '15',
  Veterinary: '16',
  'Medical Devices': '17',
  Cosmetics: '18',
  'Apparel & Fashion': '19',
  'Sporting Goods': '20',
  Tobacco: '21',
  Supermarkets: '22',
  'Food Production': '23',
  'Consumer Electronics': '24',
  'Consumer Goods': '25',
  Furniture: '26',
  Retail: '27',
  Entertainment: '28',
  'Gambling & Casinos': '29',
  'Leisure, Travel & Tourism': '30',
  Hospitality: '31',
  Restaurants: '32',
  Sports: '33',
  'Food & Beverages': '34',
  'Motion Pictures and Film': '35',
  'Broadcast Media': '36',
  'Museums and Institutions': '37',
  'Fine Art': '38',
  'Performing Arts': '39',
  'Recreational Facilities and Services': '40',
  Banking: '41',
  Insurance: '42',
  'Financial Services': '43',
  'Real Estate': '44',
  'Investment Banking': '45',
  'Investment Management': '46',
  Accounting: '47',
  Construction: '48',
  'Building Materials': '49',
  'Architecture & Planning': '50',
  'Civil Engineering': '51',
  'Aviation & Aerospace': '52',
  Automotive: '53',
  Chemicals: '54',
  Machinery: '55',
  'Mining & Metals': '56',
  'Oil & Energy': '57',
  Shipbuilding: '58',
  Utilities: '59',
  Textiles: '60',
  'Paper & Forest Products': '61',
  'Railroad Manufacture': '62',
  Farming: '63',
  Ranching: '64',
  Dairy: '65',
  Fishery: '66',
  'Primary/Secondary Education': '67',
  'Higher Education': '68',
  'Education Management': '69',
  Research: '70',
  Military: '71',
  'Legislative Office': '72',
  Judiciary: '73',
  'International Affairs': '74',
  'Government Administration': '75',
  'Executive Office': '76',
  'Law Enforcement': '77',
  'Public Safety': '78',
  'Public Policy': '79',
  'Marketing and Advertising': '80',
  Newspapers: '81',
  Publishing: '82',
  Printing: '83',
  'Information Services': '84',
  Libraries: '85',
  'Environmental Services': '86',
  'Package/Freight Delivery': '87',
  'Individual & Family Services': '88',
  'Religious Institutions': '89',
  'Civic & Social Organization': '90',
  'Consumer Services': '91',
  'Transportation/Trucking/Railroad': '92',
  Warehousing: '93',
  'Airlines/Aviation': '94',
  Maritime: '95',
  'Information Technology and Services': '96',
  'Market Research': '97',
  'Public Relations and Communications': '98',
  Design: '99',
  'Non-Profit Organization Management': '100',
  'Fund-Raising': '101',
  'Program Development': '102',
  'Writing and Editing': '103',
  'Staffing and Recruiting': '104',
  'Professional Training & Coaching': '105',
  'Venture Capital & Private Equity': '106',
  'Political Organization': '107',
  'Translation and Localization': '108',
  'Computer Games': '109',
  'Events Services': '110',
  'Arts and Crafts': '111',
  'Electrical/Electronic Manufacturing': '112',
  'Online Media': '113',
  Nanotechnology: '114',
  Music: '115',
  'Logistics and Supply Chain': '116',
  Plastics: '117',
  'Computer & Network Security': '118',
  Wireless: '119',
  'Alternative Dispute Resolution': '120',
  'Security and Investigations': '121',
  'Facilities Services': '122',
  'Outsourcing/Offshoring': '123',
  'Health, Wellness and Fitness': '124',
  'Alternative Medicine': '125',
  'Media Production': '126',
  Animation: '127',
  'Commercial Real Estate': '128',
  'Capital Markets': '129',
  'Think Tanks': '130',
  Philanthropy: '131',
  'E-Learning': '132',
  Wholesale: '133',
  'Import and Export': '134',
  'Mechanical or Industrial Engineering': '135',
  Photography: '136',
  'Human Resources': '137',
  'Business Supplies and Equipment': '138',
  'Mental Health Care': '139',
  'Graphic Design': '140',
  'International Trade and Development 6 Internet': '141',
  'Wine and Spirits': '142',
  'Luxury Goods & Jewelry': '143',
  'Renewables & Environment': '144',
  'Glass, Ceramics & Concrete': '145',
  'Packaging and Containers': '146',
  'Industrial Automation': '147',
  'Government Relations': '148',
};

export interface Country {
  Code__c: string;
  Label: string;
  Currency__c: string;
  Exchange_Rate__c: number;
  Currency_Symbol__c: string;
}

export class LinkedInDataService {
  static async getConfig(sf: SalesforceClient): Promise<LinkedInConfiguration> {
    const query = `SELECT 
            LinkedIn_Job_Tag_Free_Listing__c, 
            LinkedIn_Job_Tag_Slot__c, 
            Master_Brand_Id__c 
       FROM LinkedIn_Integration__c`;
    const result = await sf.querySOQL<LinkedInConfiguration>(query);
    if (result.length === 0) {
      throw new Error('LinkedIn configuration not found');
    }
    return result[0];
  }

  static async fetchCampaigns(sf: SalesforceClient): Promise<LinkedInCampaign[]> {
    const query = `
        SELECT Id,
               Type,
               InternalId__c,
               Ad_Title__c,
               Description,
               LI_Ad_Job_Functions__c,
               LI_Ad_Industries__c,
               LI_Ad_Experience_Level__c,
               LI_Ad_Skills__c,
               Ad_Posted_Country_Name__c,
               Ad_Posted_Location_Name__c,
               Ad_OneClick_Apply__c,
               Pipeline__r.Name,
               Pipeline__r.ProductCode,
               Pipeline__r.Geographic_Restriction__c,
               Pipeline__r.Hourly_Rate__c,
               Pipeline__r.Brand__r.Name,
               Pipeline__r.Brand__r.LinkedIn_Company_ID__c,
               Pipeline__r.Job_Type__c,
               Job_Board_Cell__r.Pipeline_Job_Title__r.Apply_URL__c,
               Job_Board_Cell__r.Location__r.City_Name__c,
               Job_Board_Cell__r.Location__r.Is_Country__c,
               Job_Board_Cell__r.Location__r.Country__c,
               Job_Board_Cell__r.Location__r.State_Name__c
        FROM Campaign
        WHERE RecordType.DeveloperName = 'LinkedIn_Job_Ad'
          AND Status IN ('In Progress', 'Planned')
          AND Job_Board_Cell__c != NULL
    `;

    return await sf.querySOQL<LinkedInCampaign>(query);
  }

  static async fetchMasterBrand(sf: SalesforceClient, brandId: string): Promise<LinkedInBrand | null> {
    if (brandId == null) {
      return null;
    }
    const query = `SELECT Name, LinkedIn_Company_ID__c FROM Brand__c WHERE Id = '${brandId}'`;
    const result = await sf.querySOQL<LinkedInBrand>(query);
    return result[0] ?? null;
  }

  static async fetchCountries(sf: SalesforceClient): Promise<Country[]> {
    return await sf.querySOQL<Country>(`
      SELECT 
          Code__c, 
          Label, 
          Currency__c, 
          Exchange_Rate__c, 
          Currency_Symbol__c 
      FROM Country__mdt
  `);
  }
}
