/**
 * Copyright 2025 Amazon.com, Inc. or its affiliates. All Rights Reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License").
 * You may not use this file except in compliance with the License.
 * A copy of the License is located at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * or in the "license" file accompanying this file. This file is distributed
 * on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either
 * express or implied. See the License for the specific language governing
 * permissions and limitations under the License.
 */

/**
 * Sample script demonstrating how to use the CreatorsAPI Node.js SDK for GetReport API
 * GetReport operation retrieves a specific report file for your store.
 * 
 * Run `npm install` and `npm run build` before executing with `node sampleGetReport.js`
 */

const { ApiClient, DefaultApi, GetReportRequestContent } = require('../dist/index');

// Initialize API client
const apiClient = new ApiClient();

// Add credential details
apiClient.credentialId = "<YOUR CREDENTIAL ID>";
apiClient.credentialSecret = "<YOUR CREDENTIAL SECRET>";
apiClient.version = "<YOUR CREDENTIAL VERSION>";

// Initialize API
const api = new DefaultApi(apiClient);

/**
 * Sample function to demonstrate GetReport API usage
 */
async function getReport() {
    /**
     * Add marketplace. For more details, refer: https://affiliate-program.amazon.com/creatorsapi/docs/en-us/api-reference/common-request-headers-and-parameters#marketplace-locale-reference
     */
    const marketplace = "<YOUR MARKETPLACE>";

    // Create GetReport request
    const getReportRequest = new GetReportRequestContent();
    
    // Specify report filename (can be found from ListReports API response)
    getReportRequest.filename = "<YOUR FILENAME>";

    try {
        const response = await api.getReport(marketplace, getReportRequest);
        console.log('API called successfully.');
        console.log('Complete Response:\n', JSON.stringify(response, null, 2));
    } catch (error) {
        console.log('Error calling Creators API!');
        console.log('Full Error Object:\n', JSON.stringify(error, null, 2));
    }
}

getReport();
