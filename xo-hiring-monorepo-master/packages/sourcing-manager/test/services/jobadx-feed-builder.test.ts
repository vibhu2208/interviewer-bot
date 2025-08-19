import { describe, expect, it, jest } from '@jest/globals';
import * as xmlbuilder from 'xmlbuilder';
import { Campaign } from '../../src/services/jobadx-data-service';
import { buildJobAdXXmlFeed, buildJobXml, getJob, Job } from '../../src/services/jobadx-feed-builder';

describe('JobAdX Feed Generator', () => {
  const mockCampaign: Campaign = {
    Id: 'camp123',
    InternalId__c: 'test-123',
    Ad_Title__c: 'Senior Developer',
    Description: 'Test job description',
    Ad_Posted_Country_Name__c: 'United States',
    Ad_Posted_Location_Name__c: 'New York',
    Pipeline__c: 'pipe123',
    Pipeline__r: {
      CreatedDate: '2024-01-01T00:00:00Z',
      Brand__r: { Name: 'TestBrand' },
      ProductCode: 'DEV',
      Job_Type__c: 'full-time',
      Yearly_Rate__c: 120000,
      Family: 'Technology',
      Target_CPA__c: 5000,
    },
    Job_Board_Cell__r: {
      Location__c: 'New York',
      Pipeline_Job_Title__c: 'Senior Developer',
      Pipeline_Job_Title__r: {
        Landing_Page_URL__c: 'https://example.com/jobs',
      },
      Location__r: {
        State_Code__c: 'NY',
      },
    },
  };

  const mockCountries: Record<string, string> = {
    'United States': 'USA',
    India: 'IND',
  };

  const activePipelinesWithWorkLocations = new Set(['other-pipe']);

  describe('buildJobAdXXmlFeed', () => {
    it('should generate complete XML feed with all required elements', () => {
      const xml = buildJobAdXXmlFeed([mockCampaign], activePipelinesWithWorkLocations, mockCountries);

      expect(xml).toContain('<source>');
      expect(xml).toContain('<publisher_name>Crossover</publisher_name>');
      expect(xml).toContain('<publisher_url>https://www.crossover.com</publisher_url>');
      expect(xml).toContain('<last_build_date>');
      expect(xml).toContain('<job>');
    });

    it('should handle empty campaign list', () => {
      const xml = buildJobAdXXmlFeed([], activePipelinesWithWorkLocations, mockCountries);

      expect(xml).toContain('<source>');
      expect(xml).not.toContain('<job>');
    });
  });

  describe('getJob', () => {
    it('should transform campaign into job object with all required fields', () => {
      const job = getJob(mockCampaign, activePipelinesWithWorkLocations, mockCountries);

      expect(job).toMatchObject({
        campaignId: 'camp123',
        title: 'Senior Developer',
        employer: 'TestBrand',
        organization: 'Crossover',
        jobType: 'Full-Time',
        country: 'USA',
        remoteType: 'WFH',
        targetCpa: 5000,
      });
    });

    it('should handle work location types correctly', () => {
      // Remote job (not in activePipelinesWithWorkLocations)
      let job = getJob(mockCampaign, activePipelinesWithWorkLocations, mockCountries);
      expect(job.remoteType).toBe('WFH');

      // Office job (in activePipelinesWithWorkLocations)
      const activeLocationsSet = new Set([mockCampaign.Pipeline__c]);
      job = getJob(mockCampaign, activeLocationsSet, mockCountries);
      expect(job.remoteType).toBeUndefined();
    });

    it('should format salary correctly', () => {
      const job = getJob(mockCampaign, activePipelinesWithWorkLocations, mockCountries);
      expect(job.salary).toBe('$120,000');
    });

    it('should handle missing country mapping', () => {
      const campaign = {
        ...mockCampaign,
        Ad_Posted_Country_Name__c: 'Unknown Country',
      };
      const job = getJob(campaign, activePipelinesWithWorkLocations, mockCountries);
      expect(job.country).toBe('Unknown Country');
    });
  });

  describe('buildJobXml', () => {
    let xmlRoot: any;
    let job: Job;

    beforeEach(() => {
      xmlRoot = xmlbuilder.create('source');
      job = getJob(mockCampaign, activePipelinesWithWorkLocations, mockCountries);
    });

    it('should generate valid job XML with all required fields', () => {
      const result = buildJobXml(xmlRoot, job);
      const xml = xmlRoot.end({ pretty: true });

      expect(result).toBe(true);
      expect(xml).toContain(`<title><![CDATA[${job.title}]]></title>`);
      expect(xml).toContain(`<identifier><![CDATA[${job.identifier}]]></identifier>`);
      expect(xml).toContain(`<organization><![CDATA[Crossover]]></organization>`);
      expect(xml).toContain(`<job_type><![CDATA[Full-Time]]></job_type>`);
    });

    it('should handle missing optional fields', () => {
      const partialJob = {
        ...job,
        region: '',
        industry: '',
        postal_code: '',
        valid_through: '',
      };

      const result = buildJobXml(xmlRoot, partialJob);
      const xml = xmlRoot.end({ pretty: true });

      expect(result).toBe(true);
      expect(xml).not.toContain('<industry>');
      expect(xml).not.toContain('<postal_code>');
      expect(xml).not.toContain('<valid_through>');
    });

    it('should return false when required fields are missing', () => {
      const invalidJob = { ...job, title: '' };
      const result = buildJobXml(xmlRoot, invalidJob);

      expect(result).toBe(false);
    });

    it('should properly escape HTML in description', () => {
      const jobWithHtml = {
        ...job,
        description: 'Description with&nbsp;spaces',
      };

      buildJobXml(xmlRoot, jobWithHtml);
      const xml = xmlRoot.end({ pretty: true });

      expect(xml).toContain('Description with spaces');
      expect(xml).not.toContain('&nbsp;');
    });
  });

  describe('Utility Functions', () => {
    it('should format target location correctly', () => {
      const job = getJob(mockCampaign, activePipelinesWithWorkLocations, mockCountries);
      expect(job.targetLocation).toBe('New York, NY, USA');
    });

    it('should handle salary precision correctly', () => {
      const campaign = {
        ...mockCampaign,
        Pipeline__r: {
          ...mockCampaign.Pipeline__r,
          Yearly_Rate__c: 123456789,
        },
      };
      const job = getJob(campaign, activePipelinesWithWorkLocations, mockCountries);
      expect(job.salary).toBe('$123,400,000');
    });
  });
});
