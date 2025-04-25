const SETTINGS_PROD = {
  API_URL: "https://checkra-svc.azurewebsites.net"
};

const SETTINGS_DEV = {
  API_URL: "http://localhost:8080"
};


const Settings = import.meta.env.PROD ? SETTINGS_PROD : SETTINGS_DEV;

export default Settings;