import axios, { AxiosInstance, AxiosResponse } from 'axios';

interface AuthResponse {
  token_type: string;
  expires_in: number;
  access_token: string;
  scope: string;
  refresh_token: string;
}

interface Backup {
  id: number;
  num_sections: number;
  num_updated_items: number;
  num_sections_error: number;
  num_api_calls: number;
  num_inserted_items: number;
  num_sections_info: number;
  num_sections_warning: number;
  num_sections_ok: number;
  num_deleted_items: number;
  trigger_type: string;
  completed_at: string;
  status: string;
}

interface BackupObject {
  id: number;
  download_removed_link: string;
  download_changed_link: string;
  download_added_link: string;
  download_link: string;
  num_api_calls: number;
  num_updated_items: number;
  num_deleted_items: number;
  num_inserted_items: number;
  num_items: number;
  name: string;
  message: string;
  status: string;
}

interface Job {
  id: number;
  progress: number;
  results: string[];
  status: string;
  title: string;
}

interface Service {
  archived: boolean;
  provider: string;
  num_items: number;
  displayed_name: string;
  return_message: string;
  total_size: number;
  org_id: string;
  id: number;
  secondary_name: string | null;
  return_code: number;
  last_backup: string;
  enabled: number;
  status: string;
}

export class OwnDataClient {
  private axiosInstance: AxiosInstance;

  constructor(private regionalDomain: string, private refreshToken: string) {
    this.axiosInstance = axios.create({
      baseURL: `https://${regionalDomain}`,
    });
  }

  async authenticate(): Promise<void> {
    const response: AxiosResponse<AuthResponse> = await axios.post(
      'https://auth.owndata.com/oauth2/aus4c3z3l8FqrbqDU4h7/v1/token',
      {
        grant_type: 'refresh_token',
        scope: 'api:access',
        refresh_token: this.refreshToken,
        client_id: '0oa4c413eq8wwcEzP4h7',
      },
      {
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      },
    );

    this.axiosInstance.defaults.headers.common['Authorization'] = `Bearer ${response.data.access_token}`;
  }

  async getBackups(serviceId: string | number): Promise<Backup[]> {
    const response: AxiosResponse<Backup[]> = await this.axiosInstance.get(`/api/v1/services/${serviceId}/backups`);
    return response.data;
  }

  async getBackup(serviceId: string | number, backupId: string | number): Promise<Backup> {
    const response: AxiosResponse<Backup> = await this.axiosInstance.get(
      `/api/v1/services/${serviceId}/backups/${backupId}`,
    );
    return response.data;
  }

  async getBackupObjects(serviceId: string | number, backupId: string | number): Promise<BackupObject[]> {
    const response: AxiosResponse<BackupObject[]> = await this.axiosInstance.get(
      `/api/v1/services/${serviceId}/backups/${backupId}/objects`,
    );
    return response.data;
  }

  async exportBackup(
    serviceId: string,
    backupId: string,
    exportFormat: string,
    includeAttachments: boolean,
    sqlDialect?: string,
    objects?: string[],
  ): Promise<{ job_id: number }> {
    const formData = new FormData();
    formData.append('export_format', exportFormat);
    formData.append('include_attachments', includeAttachments.toString());
    if (sqlDialect) {
      formData.append('sql_dialect', sqlDialect);
    }
    if (objects) {
      objects.forEach((obj) => formData.append('objects', obj));
    }

    const response: AxiosResponse<{ job_id: number }> = await this.axiosInstance.post(
      `/api/v1/services/${serviceId}/backups/${backupId}/export`,
      formData,
    );
    return response.data;
  }

  async exportBackupToEndpoint(
    serviceId: string | number,
    backupId: string | number,
    endpointId: string,
    objects?: string[],
  ): Promise<{ job_id: number }> {
    const formData = new FormData();
    formData.append('endpoint_id', endpointId);
    if (objects) {
      objects.forEach((obj) => formData.append('objects', obj));
    }

    const response: AxiosResponse<{ job_id: number }> = await this.axiosInstance.post(
      `/api/v1/services/${serviceId}/backups/${backupId}/export_to_endpoint`,
      formData,
    );
    return response.data;
  }

  async getJobs(): Promise<Job[]> {
    const response: AxiosResponse<Job[]> = await this.axiosInstance.get('/api/v1/jobs');
    return response.data;
  }

  async getJob(jobId: string | number): Promise<Job> {
    const response: AxiosResponse<Job> = await this.axiosInstance.get(`/api/v1/jobs/${jobId}`);
    return response.data;
  }

  async getServices(): Promise<Service[]> {
    const response: AxiosResponse<Service[]> = await this.axiosInstance.get('/api/v1/services');
    return response.data;
  }

  async getService(serviceId: string): Promise<Service> {
    const response: AxiosResponse<Service> = await this.axiosInstance.get(`/api/v1/services/${serviceId}`);
    return response.data;
  }

  async backupServiceNow(serviceId: string): Promise<void> {
    await this.axiosInstance.post(`/api/v1/services/${serviceId}/backup_now`);
  }

  async backupSpecificObjectsNow(serviceId: string, objects: string[]): Promise<void> {
    const formData = new FormData();
    objects.forEach((obj) => formData.append('list_of_objects', obj));

    await this.axiosInstance.post(`/api/v1/services/${serviceId}/backup_specific_objects_now`, formData);
  }
}
