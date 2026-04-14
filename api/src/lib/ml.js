import axios from 'axios';
import FormData from 'form-data';
const mlclient = axios.create({baseURL: process.env.ML_SERVICE_URL,
    timeout:30000
})