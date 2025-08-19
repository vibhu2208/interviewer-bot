import { APIGatewayProxyEvent } from 'aws-lambda';
import { AxiosResponse } from 'axios';
import { logger } from '../logger';
import { axiosResponse, HttpStatusCodes } from '../responses';
import { AnyParameter, ParameterType } from '../validation';
import countries from '../data/countries.json';
import { SSMConfig } from '../ssm-config';
import {
  camelCasePropertyNameResolver,
  createDeliveryClient,
  ITaxonomyGroup,
  ITaxonomyTerms,
  Responses,
} from '@kontent-ai/delivery-sdk';
import { Testimonial } from './models/testimonial';
const countyGlobal = 'Global';
interface Country {
  continent: string;
  sub_continent: string;
  country: string;
  iso_code: string;
}

async function getTestimonialAPI(): Promise<Responses.IListContentItemsResponse<Testimonial>> {
  const config = await SSMConfig.getForEnvironment();
  const deliveryClient = createDeliveryClient({
    environmentId: config.kontentProjectId,
    propertyNameResolver: camelCasePropertyNameResolver,
  });

  const response = await deliveryClient
    .items<Testimonial>()
    .type('testimonial')
    .depthParameter(1)
    .anyFilter('elements.type', ['interview', 'story'])
    .orderByDescending('elements.date')
    .withCustomParameter('kontent-cache', 'on')
    .toPromise();

  const data = response.data;

  return data;
}

export class Testimonials {
  public static async allContinents(): Promise<AxiosResponse<{ data: string[] }>> {
    const continents: string[] = [...new Set(countries.map((item) => item.continent))];
    return axiosResponse(HttpStatusCodes.Ok, {
      data: continents,
    });
  }

  public static async testimonialsByCountry(event: APIGatewayProxyEvent): Promise<AxiosResponse> {
    try {
      const country = new AnyParameter(event, 'country', ParameterType.QueryString);
      if (!country) {
        return axiosResponse(HttpStatusCodes.BadRequest);
      }

      const testimonialAPI = await getTestimonialAPI();
      const data = testimonialAPI;
      const { loggedInCountry, subcontinentCountries, continentCountries, globalContinent } = extractTreeCountries(
        country.toString(),
      );

      if (loggedInCountry === undefined || loggedInCountry === null) {
        return axiosResponse(HttpStatusCodes.Ok, { data: data.items });
      } else {
        const testimonialData = getTestimonials(
          loggedInCountry,
          subcontinentCountries,
          continentCountries,
          globalContinent,
          data,
        );

        return axiosResponse(HttpStatusCodes.Ok, { data: testimonialData });
      }
    } catch (error) {
      logger.error(`Error while fetching testimonials by country`, error as Error);
      return axiosResponse(HttpStatusCodes.InternalServerError);
    }
  }

  public static async testimonialsByCountryAndDomain(event: APIGatewayProxyEvent): Promise<AxiosResponse> {
    const country = new AnyParameter(event, 'country', ParameterType.QueryString);
    const domain = new AnyParameter(event, 'domain', ParameterType.QueryString);

    if (!country || !domain) {
      return axiosResponse(HttpStatusCodes.BadRequest);
    }
    const config = await SSMConfig.getForEnvironment();
    const deliveryClient = createDeliveryClient({
      environmentId: config.kontentProjectId,
      propertyNameResolver: camelCasePropertyNameResolver,
    });
    const testimonialAPI = await getTestimonialAPI();
    const [functionalResponse, testimonialResponse] = await Promise.all([
      deliveryClient.taxonomy('functional_domain').withCustomParameter('kontent-cache', 'on').toPromise(),
      testimonialAPI,
    ]);

    const { loggedInCountry, subcontinentCountries, continentCountries, globalContinent } = extractTreeCountries(
      country.toString(),
    );

    if (loggedInCountry === undefined || loggedInCountry === null) {
      return axiosResponse(HttpStatusCodes.Ok, {
        data: testimonialResponse.items,
      });
    }

    const domains = getDomains(domain.toString(), functionalResponse.data.taxonomy);
    const testimonailData = getTestimonialsbyDomain(
      loggedInCountry,
      subcontinentCountries,
      continentCountries,
      globalContinent,
      testimonialResponse,
      domains,
    );
    logger.debug('Testimonials', {
      testimonials: testimonailData,
    });
    return axiosResponse(HttpStatusCodes.Ok, { data: { testimonials: testimonailData } });
  }

  public static async testimonialsByContinent(event: APIGatewayProxyEvent): Promise<AxiosResponse> {
    const continent = new AnyParameter(event, 'continent', ParameterType.QueryString);
    if (!continent) {
      return axiosResponse(HttpStatusCodes.BadRequest);
    }

    const testimonialAPI = await getTestimonialAPI();
    try {
      const data = testimonialAPI;

      const contientCountries = countries.filter((x: { continent: string }) => x.continent === continent.toString());
      const globalContinentCountries = countries.filter((x: { continent: string }) => x.continent === countyGlobal);

      const continentTestimonialData = contientCountries
        ? data.items.filter((f: { elements: { country: { value: { name: string }[] } } }) =>
            contientCountries.some((item: { country: string }) => item.country === f.elements?.country?.value[0]?.name),
          )
        : [];

      const globalTestimonialData = globalContinentCountries
        ? data.items.filter((f: { elements: { country: { value: { name: string }[] } } }) =>
            globalContinentCountries.some(
              (item: { country: string }) => item.country === f.elements?.country?.value[0]?.name,
            ),
          )
        : [];

      return axiosResponse(HttpStatusCodes.Ok, {
        data: [...continentTestimonialData, ...globalTestimonialData],
      });
    } catch (error) {
      logger.info(`Error while fetching testimonials by continent`, error as Error);
      return axiosResponse(HttpStatusCodes.InternalServerError);
    }
  }

  public static async countryContinent(event: APIGatewayProxyEvent): Promise<AxiosResponse> {
    const country = new AnyParameter(event, 'country', ParameterType.QueryString);
    if (!country) {
      return axiosResponse(HttpStatusCodes.BadRequest);
    }
    const filteredCountries = countries.filter((x: { iso_code: string }) => x.iso_code === country.toString())[0];
    return axiosResponse(HttpStatusCodes.Ok, {
      data: filteredCountries,
    });
  }
}

function extractTreeCountries(country: string) {
  const loggedInCountry = countries.find((x: { iso_code: string }) => x.iso_code === country);
  const subcontinentCountries = loggedInCountry
    ? countries
        .filter((x: { sub_continent: string }) => x.sub_continent === loggedInCountry.sub_continent)
        .filter((x: { country: string }) => x.country !== loggedInCountry.country)
    : [];
  const continentCountries = loggedInCountry
    ? countries
        .filter((x: { continent: string }) => x.continent === loggedInCountry.continent)
        .filter((x: { sub_continent: string }) => x.sub_continent !== loggedInCountry.sub_continent)
    : [];
  const globalContinent = countries.filter((x: { continent: string }) => x.continent === country);

  return {
    loggedInCountry,
    subcontinentCountries,
    continentCountries,
    globalContinent,
  };
}

function getDomains(reqDomain: string, functionalData: ITaxonomyGroup): string[] {
  let domains: string[] = [reqDomain];
  if (functionalData.terms.filter((x: { codename: string }) => x.codename === reqDomain)[0] !== undefined) {
    domains = [
      ...domains,
      ...functionalData.terms
        .filter((x: { codename: string }) => x.codename === reqDomain)[0]
        .terms.map((x: { codename: string }) => x.codename),
    ];
  } else {
    const parentCodeName = functionalData.terms.filter((x: { terms: ITaxonomyTerms[] }) =>
      x.terms.some((y: { codename: string }) => y.codename === reqDomain),
    )[0]?.codename;
    const sbc = functionalData.terms
      .filter((x: { codename: string }) => x.codename === parentCodeName)[0]
      ?.terms.map((x: { codename: string }) => x.codename);
    domains = [...domains, parentCodeName, ...sbc.filter((x: string) => x !== reqDomain)];
  }
  return domains;
}

function getTestimonialsbyDomain(
  loggedInCountry: Country,
  subcontinentCountries: Country[],
  continentCountries: Country[],
  globalContinent: Country[],
  testimonialResponse: Responses.IListContentItemsResponse<Testimonial>,
  domains: string[],
) {
  const getPriority = (testimonial: Testimonial) => {
    const countryMatch = loggedInCountry && testimonial?.elements?.country?.value[0]?.name === loggedInCountry.country;
    const subcontinentMatch = subcontinentCountries?.some(
      (item: { country: string }) => item.country === testimonial?.elements?.country?.value[0]?.name,
    );
    const continentMatch = continentCountries?.some(
      (item: { country: string }) => item.country === testimonial?.elements?.country?.value[0]?.name,
    );
    const globalMatch = globalContinent?.some(
      (item: { country: string }) => item.country === testimonial?.elements?.country?.value[0]?.name,
    );

    if (countryMatch) return 1;
    if (subcontinentMatch) return 2;
    if (continentMatch) return 3;
    if (globalMatch) return 4;
    // If none of the above criteria match, assign a lower priority
    return 5;
  };

  const testimonailData = testimonialResponse.items
    .filter((testimonial: Testimonial) =>
      domains.some((domain: string) =>
        testimonial.elements.functionalDomain.value?.some((functionalDomain) => functionalDomain.codename === domain),
      ),
    )
    .sort((a: Testimonial, b: Testimonial) => getPriority(a) - getPriority(b));

  return testimonailData;
}

function getTestimonials(
  loggedInCountry: Country,
  subcontinentCountries: Country[],
  contientCountries: Country[],
  globalContinet: Country[],
  data: Responses.IListContentItemsResponse<Testimonial>,
) {
  const testimonialData = data.items.map((testimonial) => ({
    testimonial,
    countryName: testimonial?.elements?.country?.value[0]?.name,
  }));

  testimonialData.sort((a, b) => {
    const priorityOrder = [
      loggedInCountry.country,
      ...subcontinentCountries.map((item) => item.country),
      ...contientCountries.map((item) => item.country),
      ...globalContinet.map((item) => item.country),
    ];

    const priorityA = priorityOrder.indexOf(a.countryName);
    const priorityB = priorityOrder.indexOf(b.countryName);

    if (priorityA === -1 && priorityB === -1) {
      return 0;
    } else if (priorityA === -1) {
      return 1;
    } else if (priorityB === -1) {
      return -1;
    } else {
      return priorityA - priorityB;
    }
  });

  return testimonialData.map((item) => item.testimonial);
}
