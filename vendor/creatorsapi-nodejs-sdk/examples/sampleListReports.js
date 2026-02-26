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
 * Sample script demonstrating how to use the CreatorsAPI Node.js SDK for ListReports API
 * ListReports operation retrieves a list of available reports for your store.
 * 
 * Run `npm install` and `npm run build` before executing with `node sampleListReports.js`
 */

const { ApiClient, DefaultApi } = require('../dist/index');

// Initialize API client
const apiClient = new ApiClient();

// Add credential details
apiClient.credentialId = "<YOUR CREDENTIAL ID>";
apiClient.credentialSecret = "<YOUR CREDENTIAL SECRET>";
apiClient.version = "<YOUR CREDENTIAL VERSION>";

// Initialize API
const api = new DefaultApi(apiClient);

/**
 * Sample function to demonstrate ListReports API usage
 */
async function listReports() {
    /**
     * Add marketplace. For more details, refer: https://affiliate-program.amazon.com/creatorsapi/docs/en-us/api-reference/common-request-headers-and-parameters#marketplace-locale-reference
     */
    const marketplace = "<YOUR MARKETPLACE>";

    try {
        const response = await api.listReports(marketplace);
        console.log('API called successfully.');
        console.log('Complete Response:\n', JSON.stringify(response, null, 2));
    } catch (error) {
        console.log('Error calling Creators API!');
        console.log('Full Error Object:\n', JSON.stringify(error, null, 2));
    }
}

listReports();
