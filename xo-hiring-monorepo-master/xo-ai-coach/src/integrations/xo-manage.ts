import axios from 'axios';

export class XoManageClient {
  private static cached: XoManageClient | null = null;
  private authToken: string;
  private apiEndpoint: string;

  constructor(authToken: string, apiEndpoint: string) {
    this.authToken = authToken;
    this.apiEndpoint = apiEndpoint;
  }

  async getUserDetails(): Promise<UserDetails> {
    const response = await axios.get(`${this.apiEndpoint}/api/identity/users/current/detail`, {
      headers: {
        'X-Auth-Token': this.authToken,
      },
    });

    return response.data as UserDetails;
  }

  async getAvailableTeams(managerId: string | number): Promise<Teams> {
    const response = await axios.get(
      `${this.apiEndpoint}/api/internal/teams/dashboard?directOnly=false&managerId=${managerId}`,
      {
        headers: {
          'X-Auth-Token': this.authToken,
        },
      },
    );

    return response.data as Teams;
  }

  async getTeamActivity(date: string, teamId: string | number): Promise<UserActivity[]> {
    const response = await axios.get(
      `${this.apiEndpoint}/api/tracker/activity/groups?date=${date}&fullTeam=true&groups=groups&refresh=false&teamId=${teamId}&weekly=true`,
      {
        headers: {
          'X-Auth-Token': this.authToken,
        },
      },
    );

    return response.data as UserActivity[];
  }

  static async getInstance(credentials: XoManageCredentials): Promise<XoManageClient> {
    if (XoManageClient.cached != null) {
      return XoManageClient.cached;
    }

    // Fetch the token
    const response = await axios.post(`${credentials.endpoint}/api/v3/token`, null, {
      auth: credentials,
    });
    const token = response.data?.token;

    if (token == null) {
      throw new Error(`Cannot authenticate XO user ${credentials.username}`);
    }

    XoManageClient.cached = new XoManageClient(token, credentials.endpoint);

    return XoManageClient.cached;
  }
}

export interface XoManageCredentials {
  username: string;
  password: string;
  endpoint: string;
}

export interface UserDetails {
  applications: {
    [key: string]: Array<{
      name: string;
      identifier: string;
      enabled: boolean;
      appUserType: string;
      links: string[];
    }>;
  };
  assignment: {
    id: number;
    jobTitle: string;
    salaryUnit: string;
    salary: number;
    weeklyLimit: number;
    team: {
      id: number;
      name: string;
      company: {
        id: number;
        name: string;
      };
    };
    selection: {
      marketplaceMember: {
        application: {
          candidate: {
            id: number;
            userId: number;
            email: string;
            firstName: string;
            lastName: string;
            printableName: string;
            photoUrl: string;
            location: {
              country: string;
              city: string;
              state: string;
              timeZone: TimeZone;
            };
            avatarTypes: string[];
            userAvatars: UserAvatar[];
            feedbackRequired: boolean;
            skypeId: string;
          };
        };
      };
    };
    manager: UserInfo;
    status: string;
    salaryType: string;
    startDate: string;
  };
  managerAvatar: {
    id: number;
    userId: number;
    //... rest of the properties (similar to `UserInfo` interface below)
  } & UserInfo;
  headline: string;
  summary: string;
  id: number;
  email: string;
  firstName: string;
  lastName: string;
  fullName: string;
  photoUrl: string;
  appFeatures: string[];
  userAvatars: UserAvatar[];
  avatarTypes: string[];
  location: {
    country: string;
    city: string;
    state: string;
    timeZone: TimeZone;
  };
  infoShared: boolean;
  communicationStatus: string;
  userSecurity: {
    securityQuestion: string;
    linkedInLogin: boolean;
    enabled: boolean;
    signupMethod: string;
    accountNonExpired: boolean;
    accountNonLocked: boolean;
    credentialsNonExpired: boolean;
  };
}

interface TimeZone {
  id: number;
  name: string;
  offset: number;
  hourlyOffset: string;
}

interface UserAvatar {
  id: number;
  type: string;
}

interface UserInfo {
  id: number;
  userId: number;
  email: string;
  firstName: string;
  lastName: string;
  printableName: string;
  photoUrl: string;
  location: {
    country: string;
    timeZone?: TimeZone;
    city?: string;
    state?: string;
  };
  avatarTypes: string[];
  userAvatars: UserAvatar[];
  feedbackRequired: boolean;
}

export interface Teams {
  teams: Team[];
  assignments: AssignmentInfo[];
}

interface Team {
  id: number;
  name: string;
  company: SimpleCompany;
  teamOwner: TeamOwner;
  reportingManagers: ReportingManager[];
}

interface AssignmentInfo {
  id: number;
  jobTitle: string;
  salaryUnit: string;
  salary: number;
  weeklyLimit: number;
  team: SimpleCompany; // Reusing SimpleCompany since the structure is the same.
  selection: {
    marketplaceMember: {
      application: {
        candidate: CandidateInfo; // Reusing CandidateInfo from the previous code snippet.
      };
    };
  };
  manager: UserInfo; // Reusing UserInfo from the previous code snippet.
  status: string;
  assignmentAvatar: {
    id: number;
    avatarUrl: string;
  };
}

interface SimpleCompany {
  id: number;
  name: string;
}

interface TeamOwner {
  printableName: string;
  userId: number;
  id: number;
  company: SimpleCompany;
  type: string;
}

interface ReportingManager {
  printableName: string;
  userId: number;
  id: number;
  company: SimpleCompany;
  type: string;
}

interface CandidateInfo {
  id: number;
  userId: number;
  email: string;
  firstName: string;
  lastName: string;
  printableName: string;
  photoUrl: string;
  location: Location;
  avatarTypes: string[];
  userAvatars: UserAvatar[]; // Reusing UserAvatar from the previous code snippet.
  feedbackRequired: boolean;
  skypeId: string;
}

interface Location {
  country: string;
  city: string;
  state: string;
  timeZone: TimeZone; // Reusing TimeZone from the previous code snippet.
}

interface UserActivity {
  grouping: Grouping;
  assignmentHistory: AssignmentHistory;
  assignment: Assignment;
}

interface Grouping {
  periodLong: number;
  totalTrackedTime: number;
  alignmentScore: number;
  advancedGroups: AdvancedGroup[];
  focusScore: number;
  intensityScore: number;
}

interface AdvancedGroup {
  sectionName: string;
  color: string;
  groupItems: GroupItem[];
  spentTime: number;
}

interface GroupItem {
  applicationName: string;
  applicationId: number;
  categoryColor: string;
  activityLevel: string;
  spentTime: number;
}

interface AssignmentHistory {
  id: number;
  effectiveDateBegin: string;
  assignmentHistoryStatus: string;
  team: TeamInfo;
  manager: ManagerInfo;
  assignmentAvatar: AssignmentAvatar;
  salary: number;
  salaryType: string;
  salaryUnit: string;
  paymentPlatform: string;
  weeklyLimit: number;
  status: string;
  companyEmail: string;
  weekLate: number;
}

interface Assignment {
  id: number;
  selection: Selection;
  assignmentHistories: AssignmentHistory[];
  currentAssignmentHistory: AssignmentHistory;
  trackerRequired: boolean;
  jobTitle: string;
  workflowJiraUser: WorkflowJiraUser;
  overtimeWarningHours: number;
  salaryUnit: string;
  assignmentAvatar: AssignmentAvatar;
  team: TeamInfo;
  salaryType: string;
  salary: number;
  paymentPlatform: string;
  weeklyLimit: number;
  candidate: AssignmentCandidate;
  overtimeForManualHourExceedingWeeklyLimit: boolean;
  manager: ManagerInfo;
  status: string;
}

interface TeamInfo {
  id: number;
  name: string;
  company: SimpleCompany;
  metricsSetups: any[];
  deleted: boolean;
}

interface ManagerInfo {
  type: string;
  id: number;
  rejectedCandidates: any[];
  availableSlots: any[];
  manualTimeNotificationsEnabled: boolean;
  email: string;
  firstName: string;
  lastName: string;
  personal: boolean;
  manager: boolean;
  companyAdmin: boolean;
  candidate: boolean;
  userAvatars: UserAvatar[];
  printableName: string;
  userId: number;
  avatarTypes: string[];
  userSecurity: UserSecurity;
  appFeatures: any[];
  busySlots: any[];
  location: ManagerLocation;
}

interface AssignmentAvatar {
  id: number;
  avatarUrl: string;
}

interface Selection {
  id: number;
  status: string;
  marketplaceMember: MarketplaceMember;
}

interface WorkflowJiraUser {
  id: number;
  userName: string;
}

interface AssignmentCandidate {
  type: string;
  id: number;
  averageRatings: number;
  workedHours: number;
  billedHours: number;
  languages: any[];
  certifications: any[];
  educations: any[];
  employments: any[];
  connections: any[];
  skills: any[];
  skypeId: string;
  agreementAccepted: boolean;
  personal: boolean;
  candidate: boolean;
  printableName: string;
  email: string;
  userSecurity: UserSecurity;
  location: AssignmentCandidateLocation;
  firstName: string;
  lastName: string;
  manager: boolean;
  companyAdmin: boolean;
  userAvatars: UserAvatar[];
  photoUrl: string;
  userId: number;
  avatarTypes: string[];
  appFeatures: any[];
  busySlots: any[];
}

interface MarketplaceMember {
  id: number;
  application: ApplicationInfo;
  activeOn: string;
  status: string;
}

interface ApplicationInfo {
  id: number;
  candidate: AssignmentCandidate;
  status: string;
  files: any[];
  testScores: any[];
  score: number;
  yearsOfExperience: number;
  highestEducationLevel: string;
  interestInHiringEvent: boolean;
  termsAccepted: boolean;
  variants: any[];
}

interface UserSecurity {
  linkedInLogin: boolean;
  enabled: boolean;
  accountNonExpired: boolean;
  accountNonLocked: boolean;
  credentialsNonExpired: boolean;
}

interface ManagerLocation {
  country: LocationCountry;
  timeZone: TimeZone;
  city: string;
}

interface AssignmentCandidateLocation extends ManagerLocation {
  latitude?: number;
}

interface LocationCountry {
  id: number;
  name: string;
  code: string;
  allowed: boolean;
}

interface TimeZone {
  id: number;
  name: string;
  standardOffset: number;
  hourlyOffset: string;
  offset: number;
}
