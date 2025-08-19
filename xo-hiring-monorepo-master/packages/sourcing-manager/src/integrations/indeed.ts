import { SecretsManager } from '@trilogy-group/xoh-integration';
import axios, { AxiosError, AxiosInstance, RawAxiosRequestHeaders } from 'axios';
import { v4 as uuid } from 'uuid';
import { IndeedSecrets } from '../services/indeed-data-service';
import { DateTime } from 'luxon';

export interface IndeedApiClientConfig {
  sockCookie: string; // The cookie named SOCK
  shoeCookie: string; // The cookie named SHOE
  apiKey: string; // The API key header

  // Disposition API
  dispositionApiClientId: string;
  dispositionApiClientSecret: string;
}

/**
 * Indeed API Client that uses internal API to perform changes that are not available through the conventional API
 */
export class IndeedApiClient {
  static GraphQLApiEndpoint = 'https://apis.indeed.com/graphql?locale=en-US&co=US';
  static RestApiEndpoint = 'https://eax-api.indeed.com/api/';
  static OAuthTokenEndpoint = 'https://secure.indeed.com/oauth/v2/tokens';

  private restClient: AxiosInstance;
  private gqlClient: AxiosInstance;
  private dispositionApiGqlClient?: AxiosInstance;

  constructor(private config: IndeedApiClientConfig) {
    const CommonHeaders: RawAxiosRequestHeaders = {
      Cookie: [`SOCK=${this.config.sockCookie}`, `SHOE=${this.config.shoeCookie}`].join('; '),
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0',
      Origin: 'https://employers.indeed.com',
      Referer: 'https://employers.indeed.com/',
    };
    this.restClient = axios.create({
      baseURL: IndeedApiClient.RestApiEndpoint,
      headers: {
        ...CommonHeaders,
        'indeed-client-application': 'eax-reporting',
      },
    });
    this.gqlClient = axios.create({
      baseURL: IndeedApiClient.GraphQLApiEndpoint,
      headers: {
        ...CommonHeaders,
        'indeed-api-key': this.config.apiKey,
        'indeed-client-sub-app': 'curios',
        'indeed-client-sub-app-component': './IndexPage',
      },
    });
  }

  static async default(): Promise<IndeedApiClient> {
    const indeedSecrets = await IndeedApiClient.fetchIndeedSecrets();
    return new IndeedApiClient({
      apiKey: indeedSecrets.internalApiKey,
      shoeCookie: indeedSecrets.internalCookieShoe,
      sockCookie: indeedSecrets.internalCookieSock,
      dispositionApiClientId: indeedSecrets.dispositionApiClientId,
      dispositionApiClientSecret: indeedSecrets.dispositionApiClientSecret,
    });
  }

  static async fetchIndeedSecrets(): Promise<IndeedSecrets> {
    if (process.env.INDEED_SECRETS_NAME == null) {
      throw new Error('INDEED_SECRETS_NAME is not set');
    }
    const indeedSecrets = await SecretsManager.fetchSecretJson<IndeedSecrets>(process.env.INDEED_SECRETS_NAME);
    if (indeedSecrets == null) {
      throw Error(`No secrets found for "${process.env.INDEED_SECRETS_NAME}"`);
    }
    return indeedSecrets;
  }

  /**
   * Get performance of the campaigns
   * @param from ISO Date string
   * @param to ISO Date string
   * @param status Campaign status (ACTIVE, PAUSED, DELETED, 'ACTIVE,PAUSED')
   */
  async getCampaignsPerformance(from: string, to: string, status = 'ACTIVE'): Promise<ConvertedPerformance[]> {
    const response = await this.restClient.get(`v1/advertiser/adsperf?from=${from}&to=${to}&status=${status}`);
    const data = response.data as AdPerformanceReport;
    return data.performances.map(convertData);
  }

  /**
   * Create a new campaigns using internal GQL API
   * @param input
   */
  async createCampaign(input: IndeedCampaignInputData): Promise<string> {
    const requestData = {
      operationName: 'CreateCampaignWithJobs',
      variables: {
        input: {
          upid: '1:0001', // Not sure what is this
          name: input.name, // 'Campaign name',
          status: input.status ?? 'PAUSED', // Start paused if not defined
          budget: {
            recurringUnit: 'LIFETIME',
            limit: {
              amountLocal: input.budget ?? 5000, // Minimal budget is $50
              currency: 'USD',
            },
          },
          adGroups: [
            {
              ads: [
                {
                  singleSourceJobQueryGroup: {
                    sourceKey: '00000001f58aa67aa9e74485e85f14819454cbdfc6718aa90c1b8c259ba192eb314b71e0', // Not sure what this is
                    query: input.query ?? '(allbit:("0"))', // Example query by category: '(category:("PIPE_3073"))'
                  },
                },
              ],
            },
          ],
          schedule: {
            startDateTime: input.startDateTime, // '2024-05-01T05:28:10.000-05:00',
            endDateTime: input.endDateTime, // '2024-05-07T23:59:00.000-05:00'
          },
          channelConfigs: [
            {
              channel: 'INDEED',
              isEnabled: true,
            },
            {
              channel: 'GLASSDOOR',
              isEnabled: true,
            },
            {
              channel: 'TRUSTED_MEDIA_NETWORK',
              isEnabled: true,
            },
          ],
          idempotencyKey: uuid(), // '784f1127-e985-40b0-a662-5f33ee1cd09e',
          trackingToken: '',
          legacyObjective: {
            budget: true,
          },
          experimental: {},
          preferredBackend: 'ENTERPRISE',
        },
      },
      query:
        'mutation CreateCampaignWithJobs($input: CreateCampaignWithJobsInput!) {\n  createCampaignWithJobs(input: $input) {\n    campaign {\n      legacyKey\n      name\n      __typename\n    }\n    __typename\n  }\n}\n',
    };

    return (await this.performGqlRequest<any>(requestData))?.data?.updateCampaignWithJobs?.campaign?.legacyKey;
  }

  /**
   * Update campaign using internal GQL API
   * Note: The status of the campaign is not updated!
   * @param input
   */
  async updateCampaign(input: IndeedCampaignInputData): Promise<any> {
    const requestData = {
      operationName: 'UpdateCampaignWithJobs',
      variables: {
        input: {
          status: input.status,
          name: input.name, // '2024_PIPE_X',
          legacyKey: input.legacyKey, // 'ced1d8388c4cbd51',
          schedule: {
            endDateTime: input.endDateTime, // `${input.endDateTime}T23:59:00.000-05:00`
          },
          budget: {
            recurringUnit: 'LIFETIME',
            limit: {
              amountLocal: input.budget ?? 5000, // 5000,
              currency: 'USD',
            },
          },
          optInChannels: ['TRUSTED_MEDIA_NETWORK', 'INDEED', 'GLASSDOOR'],
          trackingToken: '',
          experimental: {},
          idempotencyKey: uuid(), // 'eed90e08-748b-470c-84d3-7754ba403a79',
          preferredBackend: 'ENTERPRISE',
          updateAdGroups: [
            {
              ads: [
                {
                  singleSourceJobQueryGroup: {
                    query: input.query ?? '(allbit:("0"))', // '(category:("PIPE_3073"))'
                  },
                },
              ],
            },
          ],
        },
      },
      query:
        'mutation UpdateCampaignWithJobs($input: UpdateCampaignWithJobsInput!) {\n updateCampaignWithJobs(input: $input) {\n campaign {\n status\n }\n }\n}',
    };

    return (await this.performGqlRequest<any>(requestData))?.data?.updateCampaignWithJobs?.campaign?.status;
  }

  /**
   * Update campaign status using internal GQL API
   * @param legacyKey campaign legacy key
   * @param status new campaign status
   */
  async updateCampaignStatus(legacyKey: string, status: 'PAUSED' | 'ACTIVE'): Promise<string> {
    const requestData = {
      operationName: 'UpdateCampaignWithJobs',
      variables: {
        input: {
          idempotencyKey: uuid(),
          legacyKey,
          status,
        },
      },
      extensions: {},
      query:
        'mutation UpdateCampaignWithJobs($input: UpdateCampaignWithJobsInput!) {\n updateCampaignWithJobs(input: $input) {\n campaign {\n status\n }\n }\n}',
    };

    return (await this.performGqlRequest<any>(requestData))?.data?.updateCampaignWithJobs?.campaign?.status;
  }

  /**
   * Export analytics data for a given date range
   * @param from ISO Date string
   * @param to ISO Date string
   * @param limit Number of records per page (default: 5000)
   */
  async exportAnalytics(from: string, to: string, limit = 5000): Promise<JobAnalytics[]> {
    let allResults: JobAnalytics[] = [];
    let offset = 0;
    let hasMoreData = true;

    while (hasMoreData) {
      const requestData = {
        operationName: 'JobsBulkExport',
        variables: {
          options: {
            advertiserSet: [],
            dateRanges: [{ from, to }],
            orderBy: [{ field: 'TITLE', direction: 'ASC' }],
            jobCompanyID: [],
            jobType: 'SPONSORED',
            advertisementID: [],
            aggJobID: [],
            normTitle: [],
            jobCountryRegionCityID: [],
            measureFilters: [],
            extraDimensionFilters: [],
            limit,
            offset,
          },
        },
        extensions: {},
        query: `query JobsBulkExport($options: JobCampaignDetailsInput!) {
          jobsData: jobsCampaignsAnalyticsByJobAndFullNameLocation(input: $options) {
            result {
              title
              countryFullName
              regionFullName
              city
              sumImpressions
              sumClicks
              sumApplyStarts
              sumApplies
              avgCostPerClickLocal
              avgCostPerApplyStartLocal
              avgCostPerApplyLocal
              avgCTR
              avgACR
              avgASR
              applyRate
              sumCostLocal
              jobURL
              sourceWebsite
              lastModifiedDate
              jobReferenceNumber
              firstIndexedDate
              jobCompanyName
              metadataCategory
              jobStatus
            }
          }
        }`,
      };

      const response = await this.gqlClient.post<ExportAnalyticsResponse>('', requestData);
      if (response.data?.errors && response.data?.errors.length > 0) {
        throw new Error(`GraphQL Error: ${response.data.errors.map((error) => error.message).join(', ')}`);
      }
      const results = response.data?.data?.jobsData?.result ?? [];

      allResults = allResults.concat(results);

      if (results.length < limit) {
        hasMoreData = false;
      } else {
        offset += limit;
      }
    }

    return allResults;
  }

  /**
   * Gets or initializes disposition API client with OAuth access token using client credentials flow
   * @returns Promise<AxiosInstance> The initialized disposition API GraphQL client
   */
  async getDispositionApiClient(): Promise<AxiosInstance> {
    if (this.dispositionApiGqlClient != null) {
      return this.dispositionApiGqlClient;
    }
    try {
      const response = await axios.post<OAuthTokenResponse>(
        IndeedApiClient.OAuthTokenEndpoint,
        new URLSearchParams({
          grant_type: 'client_credentials',
          client_id: this.config.dispositionApiClientId,
          client_secret: this.config.dispositionApiClientSecret,
          scope: 'employer_access',
        }),
      );

      if (!response.data?.access_token) {
        throw new Error('No access token received from Indeed OAuth endpoint');
      }

      // Create and initialize the disposition API GraphQL client with bearer token
      this.dispositionApiGqlClient = axios.create({
        baseURL: IndeedApiClient.GraphQLApiEndpoint,
        headers: {
          Authorization: `Bearer ${response.data.access_token}`,
        },
      });

      return this.dispositionApiGqlClient;
    } catch (error) {
      if (error instanceof AxiosError) {
        const errorData = error.response?.data as OAuthErrorResponse;
        const message = errorData?.error_description || errorData?.error || error.message;
        throw new Error(`Indeed OAuth token request failed (${error.response?.status}): ${message}`);
      }
      throw error;
    }
  }

  /**
   * Send disposition status data to Indeed
   * @param dispositions Array of disposition data to send
   * @returns Promise<SendPartnerDispositionPayload> The response with success/failure details
   */
  async sendDispositionStatus(dispositions: DispositionInput[]): Promise<SendPartnerDispositionPayload> {
    // Transform input to match GraphQL schema
    const partnerDispositions: PartnerDispositionInput[] = dispositions.map((disposition) => ({
      dispositionStatus: disposition.dispositionStatus,
      rawDispositionStatus: disposition.dispositionStatus, // Use enum value as raw status
      rawDispositionDetails: disposition.rawDispositionDetails ?? '',
      identifiedBy: {
        indeedApplyID: disposition.indeedApplyID,
      },
      atsName: disposition.atsName ?? 'Crossover',
      statusChangeDateTime: disposition.statusChangeDateTime ?? DateTime.now().toISO(),
    }));

    const requestData = {
      query: `
        mutation SendPartnerDisposition($input: SendPartnerDispositionInput!) {
          partnerDisposition {
            send(input: $input) {
              numberGoodDispositions
              failedDispositions {
                identifiedBy {
                  indeedApplyID
                }
                rationale
              }
            }
          }
        }
      `,
      variables: {
        input: {
          dispositions: partnerDispositions,
        },
      },
    };

    try {
      const response = await (await this.getDispositionApiClient()).post<DispositionResponse>('', requestData);

      if (response.data?.errors && response.data.errors.length > 0) {
        throw new Error(`GraphQL Error: ${response.data.errors.map((error) => error.message).join(', ')}`);
      }

      if (!response.data?.data?.partnerDisposition?.send) {
        throw new Error('Invalid response structure from disposition API');
      }

      return response.data.data.partnerDisposition.send;
    } catch (error) {
      if (error instanceof AxiosError) {
        const message = error.response?.data?.errors
          ? `GraphQL Error: ${JSON.stringify(error.response.data.errors)}`
          : error.message;
        throw new Error(`Indeed Disposition API request failed (${error.response?.status}): ${message}`);
      }
      throw error;
    }
  }

  private async performGqlRequest<T>(requestData: Record<string, any>): Promise<T> {
    try {
      const response = await this.gqlClient.post(``, requestData);
      return response.data;
    } catch (e) {
      if (e instanceof AxiosError) {
        const message =
          e.response?.data?.errors != null ? `GQL Error: ${JSON.stringify(e.response.data.errors)}` : e.message;
        throw new Error(`Indeed GQL Api Request Failed (${e.response?.status}): ${message}`);
      }
      throw e;
    }
  }
}

export interface IndeedCampaignInputData {
  name: string;
  legacyKey?: string;
  startDateTime?: string;
  endDateTime: string;
  /**
   * Minimal budget is 5000. If empty will be reset to minimal budget
   */
  budget?: number;
  /**
   * If empty will be reset to no jobs
   */
  query?: string;
  status?: 'ACTIVE' | 'PAUSED';
}

/**
 * Converts performance data from the raw Indeed API response to a more readable format
 * Extracted from the Indeed frontend app
 * @param performance
 */
function convertData(performance: Performance): ConvertedPerformance {
  const metadata = performance.metadata;
  const metrics = performance.metrics;

  const desktopMetricsOrganic: ConvertedMetric = {
    impressions: performance.metrics.DOI,
    clicks: metrics.DOC,
    clicksWithImpressions: metrics.DOCWI,
    applyStarts: metrics.DOAS,
    applies: metrics.DOA,
    interviewShows: metrics.DOIS,
    interviewStartedRSVPs: metrics.DORSVPS,
    clickThroughRate: {
      nbSourceEvents: metrics.DOI,
      nbOutcomeEvents: metrics.DOCWI,
    },
    applyStartRate: {
      nbSourceEvents: metrics.DOC,
      nbOutcomeEvents: metrics.DOAS,
    },
    applyCompletionRate: {
      nbSourceEvents: metrics.DOAS,
      nbOutcomeEvents: metrics.DOA,
    },
    applyRate: {
      nbSourceEvents: metrics.DOC,
      nbOutcomeEvents: metrics.DOA,
    },
  };
  const desktopMetricsSponsored: ConvertedMetric = {
    impressions: metrics.DSI,
    clicks: metrics.DSC,
    clicksWithImpressions: metrics.DSCWI,
    applyStarts: metrics.DSAS,
    applies: metrics.DSA,
    interviewShows: metrics.DSIS,
    interviewStartedRSVPs: metrics.DSRSVPS,
    clickThroughRate: {
      nbSourceEvents: metrics.DSI,
      nbOutcomeEvents: metrics.DSCWI,
    },
    applyStartRate: {
      nbSourceEvents: metrics.DSC,
      nbOutcomeEvents: metrics.DSAS,
    },
    applyCompletionRate: {
      nbSourceEvents: metrics.DSAS,
      nbOutcomeEvents: metrics.DSA,
    },
    applyRate: {
      nbSourceEvents: metrics.DSC,
      nbOutcomeEvents: metrics.DSA,
    },
  };
  const mobileMetricsOrganic: ConvertedMetric = {
    impressions: metrics.MOI,
    clicks: metrics.MOC,
    clicksWithImpressions: metrics.MOCWI,
    applyStarts: metrics.MOAS,
    applies: metrics.MOA,
    interviewShows: metrics.MOIS,
    interviewStartedRSVPs: metrics.MORSVPS,
    clickThroughRate: {
      nbSourceEvents: metrics.MOI,
      nbOutcomeEvents: metrics.MOCWI,
    },
    applyStartRate: {
      nbSourceEvents: metrics.MOC,
      nbOutcomeEvents: metrics.MOAS,
    },
    applyCompletionRate: {
      nbSourceEvents: metrics.MOAS,
      nbOutcomeEvents: metrics.MOA,
    },
    applyRate: {
      nbSourceEvents: metrics.MOC,
      nbOutcomeEvents: metrics.MOA,
    },
  };
  const mobileMetricsSponsored: ConvertedMetric = {
    impressions: metrics.MSI,
    clicks: metrics.MSC,
    clicksWithImpressions: metrics.MSCWI,
    applyStarts: metrics.MSAS,
    applies: metrics.MSA,
    interviewShows: metrics.MSIS,
    interviewStartedRSVPs: metrics.MSRSVPS,
    clickThroughRate: {
      nbSourceEvents: metrics.MSI,
      nbOutcomeEvents: metrics.MSCWI,
    },
    applyStartRate: {
      nbSourceEvents: metrics.MSC,
      nbOutcomeEvents: metrics.MSAS,
    },
    applyCompletionRate: {
      nbSourceEvents: metrics.MSAS,
      nbOutcomeEvents: metrics.MSA,
    },
    applyRate: {
      nbSourceEvents: metrics.MSC,
      nbOutcomeEvents: metrics.MSA,
    },
  };

  return {
    adKey: performance.adKey,
    adMetadata: {
      name: metadata.name,
      status: metadata.status,
      sourceType: metadata.sourceType,
      channels: {},
      adBudget: {
        budget: {
          amountInMinor: metadata.adBudget.budget.a,
          currency: metadata.adBudget.budget.c,
        },
        budgetType: metadata.adBudget.budgetType,
        expendedBudget: {
          amountInMinor: metadata.adBudget.expendedBudget.a,
          currency: metadata.adBudget.expendedBudget.c,
        },
      },
      notSpendingReasons: metadata.notSpendingReasons,
      interview: metadata.interview,
      interviewSessions: metadata.interviewSessions,
      editUrl: `https://employers.indeed.com/objective-campaign/${performance.adKey}`,
      isInlineEditable: true,
      bidStrategy: metadata.bidStrategy,
      creationDate: {
        date: new Date(metadata.createdAt).toISOString(),
      },
      startDate: {
        date: new Date(metadata.startDate).toISOString(),
      },
      endDate: {
        date: new Date(metadata.endDate).toISOString(),
      },
      sourceName: metadata.sourceName,
      adDailyBudget: {
        budget: {
          amountInMinor: metadata.adDailyBudget.budget.a,
          currency: metadata.adDailyBudget.budget.c,
        },
        expendedBudget: {
          amountInMinor: metadata.adDailyBudget.expendedBudget.a,
          currency: metadata.adDailyBudget.expendedBudget.c,
        },
      },
      maximumCpc: metadata.maximumCpc,
      pacing: metadata.pacing,
    },
    metrics: {
      desktop: {
        organic: desktopMetricsOrganic,
        sponsored: desktopMetricsSponsored,
      },
      mobile: {
        organic: mobileMetricsOrganic,
        sponsored: mobileMetricsSponsored,
      },
    },
  };
}

export interface ConvertedPerformance {
  updated?: boolean;

  adKey: string;
  adMetadata: {
    name: string;
    status: string;
    sourceType: string;
    channels: object;
    adBudget: {
      budget: {
        amountInMinor: number;
        currency: string;
      };
      budgetType: string;
      expendedBudget: {
        amountInMinor: number;
        currency: string;
      };
    };
    notSpendingReasons: string[];
    interview: boolean;
    interviewSessions: any[];
    editUrl: string;
    isInlineEditable: boolean;
    bidStrategy: string;
    creationDate: {
      date: string;
    };
    startDate: {
      date: string;
    };
    endDate: {
      date: string;
    };
    sourceName: string;
    adDailyBudget: {
      budget: {
        amountInMinor: number;
        currency: string;
      };
      expendedBudget: {
        amountInMinor: number;
        currency: string;
      };
    };
    maximumCpc: null | number;
    pacing: string;
  };
  metrics: {
    desktop: {
      organic: ConvertedMetric;
      sponsored: ConvertedMetric;
    };
    mobile: {
      organic: ConvertedMetric;
      sponsored: ConvertedMetric;
    };
  };
}

export interface AdPerformanceReport {
  from: string;
  to: string;
  performances: Performance[];
}

export interface Performance {
  adKey: string;
  metadata: Metadata;
  metrics: Metrics;
  adAnalytics: any[];
}

export interface Metadata {
  name: string;
  sourceType: string;
  ads: boolean;
  status: string;
  notSpendingReasons: string[];
  adBudget: BudgetDetails;
  adDailyBudget: BudgetDetails;
  maximumCpc: null | number;
  channels: string[];
  interviewSessions: any[];
  bidStrategy: string;
  createdAt: string;
  startDate: string;
  endDate: string;
  pacing: string;
  sourceName: string;
  sourceVerified: boolean;
  interview: boolean;
}

export interface BudgetDetails {
  budgetType: string;
  budget: CurrencyAmount;
  expendedBudget: CurrencyAmount;
}

export interface CurrencyAmount {
  a: number;
  c: string;
}

export interface Metrics {
  DOI: number;
  DOC: number;
  DOCWI: number;
  DOAS: number;
  DOA: number;
  DORSVPS: number;
  DORSVPC: number;
  DOIS: number;
  DSI: number;
  DSC: number;
  DSCWI: number;
  DSAS: number;
  DSA: number;
  DSRSVPS: number;
  DSRSVPC: number;
  DSIS: number;
  DCA: CurrencyAmount[];
  DCAD: DetailedCurrencyAmountDistribution;
  MOI: number;
  MOC: number;
  MOCWI: number;
  MOAS: number;
  MOA: number;
  MORSVPS: number;
  MORSVPC: number;
  MOIS: number;
  MSI: number;
  MSC: number;
  MSCWI: number;
  MSAS: number;
  MSA: number;
  MSRSVPS: number;
  MSRSVPC: number;
  MSIS: number;
  MCA: CurrencyAmount[];
  MCAD: DetailedCurrencyAmountDistribution;
  RSVP: number;
  IS: number;
}

export interface DetailedCurrencyAmountDistribution {
  C: CurrencyAmount[];
  AS: CurrencyAmount[];
  I: CurrencyAmount[];
  RSVPS: CurrencyAmount[];
}

export interface ConvertedMetric {
  impressions: number;
  clicks: number;
  clicksWithImpressions: number;
  applyStarts: number;
  applies: number;
  interviewShows: number;
  interviewStartedRSVPs: number;
  clickThroughRate: {
    nbSourceEvents: number;
    nbOutcomeEvents: number;
  };
  applyStartRate: {
    nbSourceEvents: number;
    nbOutcomeEvents: number;
  };
  applyCompletionRate: {
    nbSourceEvents: number;
    nbOutcomeEvents: number;
  };
  applyRate: {
    nbSourceEvents: number;
    nbOutcomeEvents: number;
  };
}

export interface JobAnalytics {
  title: string;
  countryFullName: string;
  regionFullName: string;
  city: string;
  sumImpressions: string;
  sumClicks: string;
  sumApplyStarts: string;
  sumApplies: string;
  avgCostPerClickLocal: number;
  avgCostPerApplyStartLocal: number;
  avgCostPerApplyLocal: number;
  avgCTR: number;
  avgACR: number;
  avgASR: number;
  applyRate: number;
  sumCostLocal: number;
  jobURL: string;
  sourceWebsite: string;
  lastModifiedDate: string;
  jobReferenceNumber: string;
  firstIndexedDate: string;
  jobCompanyName: string;
  metadataCategory: string;
  jobStatus: string;
}

export interface ExportAnalyticsResponse {
  data: {
    jobsData: {
      result: JobAnalytics[];
    };
  };
  errors?: {
    message: string;
  }[];
}

export interface OAuthTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  scope: string;
}

export interface OAuthErrorResponse {
  error: string;
  error_description?: string;
}

// Disposition Status Types
export enum DispositionStatus {
  NEW = 'NEW',
  REVIEW = 'REVIEW',
  LIKED = 'LIKED',
  CONTACTED = 'CONTACTED',
  SCREEN = 'SCREEN',
  ASSESS_QUALIFICATIONS = 'ASSESS_QUALIFICATIONS',
  INTERVIEW = 'INTERVIEW',
  OFFER_MADE = 'OFFER_MADE',
  BACKGROUND_CHECK = 'BACKGROUND_CHECK',
  VERIFY_ELIGIBILITY = 'VERIFY_ELIGIBILITY',
  HIRED = 'HIRED',
  NOT_SELECTED = 'NOT_SELECTED',
  OFFER_DECLINED = 'OFFER_DECLINED',
  WITHDRAWN = 'WITHDRAWN',
  INCOMPLETE = 'INCOMPLETE',
  UNABLE_TO_MAP = 'UNABLE_TO_MAP',
  POSITIVELY_SCREENED = 'POSITIVELY_SCREENED',
  ONBOARDED = 'ONBOARDED',
  JOB_CLOSED = 'JOB_CLOSED',
  JOB_INACTIVE = 'JOB_INACTIVE',
}

export interface DispositionInput {
  dispositionStatus: DispositionStatus;
  indeedApplyID: string;
  rawDispositionDetails?: string;
  atsName?: string;
  statusChangeDateTime?: string;
}

export interface PartnerDispositionInput {
  dispositionStatus: DispositionStatus;
  rawDispositionStatus: string;
  rawDispositionDetails: string;
  identifiedBy: {
    indeedApplyID: string;
  };
  atsName: string;
  statusChangeDateTime: string;
}

export interface SendPartnerDispositionInput {
  dispositions: PartnerDispositionInput[];
}

export interface FailedDisposition {
  identifiedBy: {
    indeedApplyID: string;
  };
  rationale: string;
}

export interface SendPartnerDispositionPayload {
  numberGoodDispositions: number;
  failedDispositions: FailedDisposition[];
}

export interface DispositionResponse {
  data: {
    partnerDisposition: {
      send: SendPartnerDispositionPayload;
    };
  };
  errors?: {
    message: string;
  }[];
}
