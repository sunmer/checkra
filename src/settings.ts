const SETTINGS_PROD = {
  API_URL: "https://checkra.io/api"
};

const SETTINGS_DEV = {
  API_URL: "http://localhost:3000/api"
};


const Settings = import.meta.env.PROD ? SETTINGS_PROD : SETTINGS_DEV;

export default Settings;