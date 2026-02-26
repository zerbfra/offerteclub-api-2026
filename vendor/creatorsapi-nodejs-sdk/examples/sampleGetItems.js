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
 * Sample script demonstrating how to use the CreatorsAPI Node.js SDK for GetItems API
 * GetItems operation retrieves item information for specified ASINs including
 * images, item info, offers, and other detailed product data.
 * 
 * Run `npm install` and `npm run build` before executing with `node sampleGetItems.js`
 */

const { ApiClient, DefaultApi, GetItemsRequestContent } = require('../dist/index');

// Initialize API client
const apiClient = new ApiClient();

// Add credential details
apiClient.credentialId = "<YOUR CREDENTIAL ID>";
apiClient.credentialSecret = "<YOUR CREDENTIAL SECRET>";
apiClient.version = "<YOUR CREDENTIAL VERSION>";

// Initialize API
const api = new DefaultApi(apiClient);

/**
 * Sample function to demonstrate GetItems API usage
 */
async function getItems() {
    /**
     * Add marketplace. For more details, refer: https://affiliate-program.amazon.com/creatorsapi/docs/en-us/api-reference/common-request-headers-and-parameters#marketplace-locale-reference
     */
    const marketplace = "<YOUR MARKETPLACE>";

    // Create GetItems request
    const getItemsRequest = new GetItemsRequestContent();
    
    // Enter your partner tag (store/tracking id)
    getItemsRequest.partnerTag = '<YOUR PARTNER TAG>';
    
    // Choose item id(s) - ASINs to retrieve
    getItemsRequest.itemIds = ['B0DLFMFBJW', 'B0BFC7WQ6R', 'B00ZV9RDKK'];

    /**
     * Choose resources you want from GetItemsResource enum
     * For more details, refer: https://affiliate-program.amazon.com/creatorsapi/docs/en-us/api-reference/operations/get-items#resources-parameter
     */
    getItemsRequest.resources = [
        'images.primary.medium',
        'itemInfo.title',
        'itemInfo.features',
        'offersV2.listings.price',
        'offersV2.listings.availability',
        'offersV2.listings.condition',
        'offersV2.listings.merchantInfo'
    ];

    try {
        const response = await api.getItems(marketplace, getItemsRequest);
        console.log('API called successfully.');
        console.log('Complete Response:\n', JSON.stringify(response, null, 2));
    } catch (error) {
        console.log('Error calling Creators API!');
        console.log('Full Error Object:\n', JSON.stringify(error, null, 2));
    }
}

getItems();
