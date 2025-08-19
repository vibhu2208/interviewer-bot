test('adds 1 + 2 to equal 3', async () => {
  // arrange
  const bucketName = 'bucketNameMock';
  process.env.bucketName = bucketName;
  const sfId = '0052j000000tStKAAU';
  const request = {
    avatarFileName: 'test-avatar.png',
    avatarFileContent: 'data:image/png;base64,iVBORw0KGgoAAArkJggg==',
  };

  const resultLocation = `https://${bucketName}.s3.amazonaws.com/${sfId}-${request.avatarFileName}`;

  const uploadFn = jest.fn(() => {
    return Promise.resolve({
      Location: resultLocation,
    });
  });

  jest.mock('aws-sdk', () => {
    return {
      S3: jest.fn(() => {
        return {
          upload: jest.fn(() => {
            return {
              promise: uploadFn,
            };
          }),
        };
      }),
    };
  });

  // act

  const { handler } = await import('../src/index');
  const result = await handler({ body: JSON.stringify(request), pathParameters: { id: sfId } });

  // assert
  expect(uploadFn).toHaveBeenCalled();
  expect(result.statusCode).toBe(200);
  expect(JSON.parse(result.body).url).toBe(resultLocation);
});
