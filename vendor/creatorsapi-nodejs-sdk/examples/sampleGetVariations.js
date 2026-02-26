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
 * Sample script demonstrating how to use the CreatorsAPI Node.js SDK for GetVariations API
 * GetVariations operation retrieves variation information for a specified parent ASIN,
 * including all child variations with images, item info, offers, and variation dimensions.
 * 
 * Run `npm install` and `npm run build` before executing with `node sampleGetVariations.js`
 */

const { ApiClient, DefaultApi, GetVariationsRequestContent } = require('../dist/index');

// Initialize API client
const apiClient = new ApiClient();

// Add credential details
apiClient.credentialId = "<YOUR CREDENTIAL ID>";
apiClient.credentialSecret = "<YOUR CREDENTIAL SECRET>";
apiClient.version = "<YOUR CREDENTIAL VERSION>";

// Initialize API
const api = new DefaultApi(apiClient);

/**
 * Sample function to demonstrate GetVariations API usage
 */
async function getVariations() {
    /**
     * Add marketplace. For more details, refer: https://affiliate-program.amazon.com/creatorsapi/docs/en-us/api-reference/common-request-headers-and-parameters#marketplace-locale-reference
     */
    const marketplace = "<YOUR MARKETPLACE>";

    // Create GetVariations request
    const getVariationsRequest = new GetVariationsRequestContent();
    
    // Enter your partner tag (store/tracking id)
    getVariationsRequest.partnerTag = '<YOUR PARTNER TAG>';
    
    // Choose ASIN for which to retrieve variations
    getVariationsRequest.asin = 'B0DLFMFBJW';

    /**
     * Choose resources you want from GetVariationsResource enum
     * For more details, refer: https://affiliate-program.amazon.com/creatorsapi/docs/en-us/api-reference/operations/get-variations#resources-parameter
     */
    getVariationsRequest.resources = [
        'images.primary.medium',
        'itemInfo.title',
        'offersV2.listings.availability',
        'offersV2.listings.condition',
        'offersV2.listings.dealDetails',
        'offersV2.listings.isBuyBoxWinner',
        'offersV2.listings.loyaltyPoints',
        'offersV2.listings.merchantInfo',
        'offersV2.listings.price',
        'offersV2.listings.type',
        'variationSummary.variationDimension'
    ];

    try {
        const response = await api.getVariations(marketplace, getVariationsRequest);
        console.log('API called successfully.');
        console.log('Complete Response:\n', JSON.stringify(response, null, 2));
    } catch (error) {
        console.log('Error calling Creators API!');
        console.log('Full Error Object:\n', JSON.stringify(error, null, 2));
    }
}

getVariations();
