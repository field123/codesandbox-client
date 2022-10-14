const IS_LOCAL_SERVER = Boolean(JSON.stringify(process.env.LOCAL_SERVER));

export default () => {
  // eslint-disable-next-line no-console
  console.log('value: ', process.env);
  // eslint-disable-next-line no-console
  console.log("'SANDPACK' in process.env: ", 'SANDPACK' in process.env);
  // return 'https://6336ef18db3bc80048a02532--ep-sandpack.netlify.app'
  if ('SANDPACK' in process.env) {
    if ('ROOT_URL' in process.env) {
      return process.env.ROOT_URL;
    }
    return '';
  }

  if (IS_LOCAL_SERVER) {
    return 'http://localhost:3000';
  }

  if (process.env.NODE_ENV === 'development') {
    return `https://${process.env.DEV_DOMAIN || 'codesandbox.test'}`;
  }

  if ('STAGING_BRANCH' in process.env) {
    return `https://${process.env.STAGING_BRANCH}.build.csb.dev`;
  }

  if ('ROOT_URL' in process.env) {
    return process.env.ROOT_URL;
  }

  return 'https://codesandbox.io';
};
