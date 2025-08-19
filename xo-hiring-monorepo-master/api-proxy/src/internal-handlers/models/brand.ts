import { IContentItem, Elements } from '@kontent-ai/delivery-sdk';

export type Brand = IContentItem<{
  heroImage: Elements.AssetsElement;
  location: Elements.TextElement;
  history: Elements.RichTextElement;
  whatWeAreDoing: Elements.RichTextElement;
  logo: Elements.AssetsElement;
  videoHook: Elements.TextElement;
  productsAndServices: Elements.RichTextElement;
  website: Elements.TextElement;
  customers: Elements.RichTextElement;
  name: Elements.TextElement;
  hook: Elements.RichTextElement;
  urlSlug: Elements.UrlSlugElement;
  photos: Elements.AssetsElement;
}>;
