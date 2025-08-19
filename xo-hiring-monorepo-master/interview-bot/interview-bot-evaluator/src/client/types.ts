export interface OrderAssessmentRequest {
  test_id: string;
  order_id: string;
  callback_url?: string;
  redirect_url?: string;
  no_delay_if_score_above?: number | null;
  candidate: {
    first_name: string;
    last_name: string;
    email: string;
    country: string;
    // 0 to 11
    test_group?: string;
  };
  duration?: number | null;
  timeboxed?: boolean | null;
}

export interface OrderAssessmentResponse {
  assessment_id: string;
  assessment_url: string;
  assessment_result_url: string;
}
