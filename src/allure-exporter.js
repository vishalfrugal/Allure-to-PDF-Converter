const chromium = require("@sparticuz/chromium").default;
const { chromium: playwrightChromium } = require("playwright-core");
const fs = require("fs");
const path = require("path");
const { PDFDocument } = require("pdf-lib");

/*
============================================================
CONFIGURATION
============================================================
*/

const PROJECT_ROOT =
    path.join(__dirname, "..");

// Vercel's deployed files are read-only. /tmp is writable but temporary.
const OUTPUT_ROOT = process.env.VERCEL
    ? path.join(process.env.TMPDIR || "/tmp", "allure-pdf-export")
    : path.join(PROJECT_ROOT, "output");

const DEFAULT_OUTPUT_DIR =
    path.join(OUTPUT_ROOT, "allure-pdf-pages");

const DEFAULT_FINAL_PDF =
    path.join(OUTPUT_ROOT, "ALLURE_COMPLETE_REPORT.pdf");


/*
============================================================
HELPERS
============================================================
*/

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}


async function waitForAllure(page, extra = 1000) {

    await sleep(1500);

    try {

        await page.waitForLoadState("networkidle", {
            timeout: 8000
        });

    } catch {
        // Allure can keep network connections active.
    }

    await sleep(extra);
}


/*
============================================================
OPEN ALLURE SECTION
============================================================
*/

async function openSection(page, hash) {

    console.log(`\nOpening section: ${hash}`);

    await page.evaluate((newHash) => {

        window.location.hash = newHash;

    }, hash);

    await waitForAllure(page, 1500);

    await page.evaluate(() => {
        window.scrollTo(0, 0);
    });

    await sleep(500);
}


/*
============================================================
GET ALLURE TREE NODES
============================================================
*/

async function getTreeNodes(page) {

    return await page.locator(".node").evaluateAll(nodes => {

        return nodes
            .filter(node => {

                const rect =
                    node.getBoundingClientRect();

                const style =
                    window.getComputedStyle(node);

                return (
                    rect.width > 0 &&
                    rect.height > 0 &&
                    style.display !== "none" &&
                    style.visibility !== "hidden"
                );

            })
            .map(node => ({

                text:
                    node.innerText?.trim() || "",

                className:
                    node.className?.toString() || "",

                href:
                    node.getAttribute("href"),

                tag:
                    node.tagName

            }));

    });
}


/*
============================================================
FIND FIRST TEST CASE
============================================================
*/

async function findFirstTestCase(page) {

    /*
     * This is based directly on the DOM structure
     * you provided.
     *
     * Actual Allure test case:
     *
     * <a class="node node_leaf node_expanded"
     *    href="#/suites/...">
     *
     */

    const testLinks =
        page.locator(
            "a.node.node_leaf"
        );


    const count =
        await testLinks.count();


    console.log(
        `Visible/available test links found: ${count}`
    );


    for (let i = 0; i < count; i++) {

        const test =
            testLinks.nth(i);


        if (!await test.isVisible()) {
            continue;
        }


        const text =
            await test.innerText()
                .catch(() => "");


        if (!text) {
            continue;
        }


        const href =
            await test.getAttribute("href");


        /*
         * Make sure it belongs to the current
         * Allure section.
         */

        if (
            href &&
            (
                href.includes("#/suites/") ||
                href.includes("#/categories/") ||
                href.includes("#/behaviors/") ||
                href.includes("#/packages/")
            )
        ) {

            return test;
        }

    }


    return null;
}


/*
============================================================
FIND FIRST COLLAPSED ALLURE NODE
============================================================
*/

async function findFirstCollapsedNode(page) {

    /*
     * Based on your DOM:
     *
     * Expanded:
     *   .node.node_expanded
     *
     * Collapsed:
     *   .node
     *
     * Leaf:
     *   .node.node_leaf
     *
     * Therefore we look for:
     *
     * .node:not(.node_expanded):not(.node_leaf)
     */

    const nodes =
        page.locator(
            ".node:not(.node_expanded):not(.node_leaf)"
        );


    const count =
        await nodes.count();


    for (let i = 0; i < count; i++) {

        const node =
            nodes.nth(i);


        if (!await node.isVisible()) {
            continue;
        }


        const text =
            await node.innerText()
                .catch(() => "");


        if (!text) {
            continue;
        }


        /*
         * Make sure this is actually a tree node
         * and not some unrelated component.
         */

        const rect =
            await node.boundingBox();


        if (!rect) {
            continue;
        }


        /*
         * Ignore anything outside the main
         * Allure content area.
         */

        if (rect.x < 170) {
            continue;
        }


        return node;
    }


    return null;
}


/*
============================================================
EXPAND FIRST BRANCH UNTIL TEST CASE
============================================================
*/

async function expandUntilTestCase(page) {

    console.log(
        "\nSearching for first test case..."
    );


    const MAX_LEVELS = 40;


    for (
        let level = 1;
        level <= MAX_LEVELS;
        level++
    ) {

        console.log(
            `Tree level ${level}`
        );


        /*
         * First check whether a test case is already
         * visible.
         */

        let test =
            await findFirstTestCase(page);


        if (test) {

            const text =
                await test.innerText()
                    .catch(() => "");


            console.log(
                `TEST CASE FOUND: ${text}`
            );


            return test;
        }


        /*
         * No test yet.
         *
         * Find the first collapsed node.
         */

        const collapsedNode =
            await findFirstCollapsedNode(page);


        if (!collapsedNode) {

            console.log(
                "No more collapsed nodes found."
            );

            return null;
        }


        const nodeText =
            await collapsedNode.innerText()
                .catch(() => "");


        console.log(
            `Expanding node: ${nodeText.substring(0, 150)}`
        );


        /*
         * IMPORTANT:
         *
         * The screenshot shows:
         *
         * <div class="node_title ...">
         *
         * inside the node.
         *
         * Click the title rather than the entire node.
         */

        const title =
            collapsedNode.locator(
                ".node_title"
            ).first();


        try {

            if (await title.count() > 0) {

                await title.scrollIntoViewIfNeeded();

                await title.click({
                    timeout: 5000
                });

            } else {

                await collapsedNode.scrollIntoViewIfNeeded();

                await collapsedNode.click({
                    timeout: 5000
                });

            }

        } catch (error) {

            console.log(
                "Normal click failed. Trying DOM click..."
            );


            try {

                await collapsedNode.evaluate(
                    element => {

                        const title =
                            element.querySelector(
                                ".node_title"
                            );

                        if (title) {
                            title.click();
                        } else {
                            element.click();
                        }

                    }
                );

            } catch (secondError) {

                console.log(
                    "Could not expand node."
                );

                console.log(
                    secondError.message
                );

                return null;
            }
        }


        /*
         * Allow Vue/React/Allure to update the tree.
         */

        await sleep(700);
    }


    return null;
}


/*
============================================================
CLICK TEST CASE
============================================================
*/

async function clickTestCase(page, testLink) {

    const text =
        await testLink.innerText()
            .catch(() => "");


    const href =
        await testLink.getAttribute("href");


    console.log(
        `\nClicking test case: ${text}`
    );


    console.log(
        `Test URL: ${href}`
    );


    await testLink.scrollIntoViewIfNeeded();


    await testLink.click({
        timeout: 5000
    });


    /*
     * Wait for the test details panel.
     */

    await sleep(1200);


    /*
     * Wait until "No item selected" disappears
     * if it exists.
     */

    try {

        await page
            .getByText(
                "No item selected",
                {
                    exact: true
                }
            )
            .waitFor({
                state: "hidden",
                timeout: 5000
            });

    } catch {
        // It may already have disappeared.
    }


    await sleep(1000);


    return true;
}


/*
============================================================
FIND RIGHT-SIDE TEST DETAIL PANEL
============================================================
*/

async function getRightSideElements(page) {

    const viewport =
        page.viewportSize();


    if (!viewport) {
        return [];
    }


    return await page.locator("body *").evaluateAll(
        (elements, width) => {

            return elements
                .filter(element => {

                    const rect =
                        element.getBoundingClientRect();

                    const style =
                        window.getComputedStyle(element);

                    return (
                        rect.width > 0 &&
                        rect.height > 0 &&
                        rect.x > width * 0.48 &&
                        style.display !== "none" &&
                        style.visibility !== "hidden"
                    );

                })
                .map(element => ({

                    text:
                        element.innerText?.trim() || "",

                    className:
                        element.className?.toString() || "",

                    tag:
                        element.tagName

                }));

        },
        viewport.width
    );
}


/*
============================================================
EXPAND TEST DETAIL SECTIONS
============================================================
*/

async function expandTestDetails(page) {

    console.log(
        "\nExpanding test details..."
    );


    /*
     * Based on your screenshots, these are the
     * important execution sections.
     */

    const sectionNames = [

        "Set up",

        "Test body",

        "Tear down"

    ];


    for (const sectionName of sectionNames) {

        /*
         * Find exact text.
         */

        const matches =
            page.getByText(
                sectionName,
                {
                    exact: true
                }
            );


        const count =
            await matches.count();


        for (let i = 0; i < count; i++) {

            const element =
                matches.nth(i);


            if (!await element.isVisible()) {
                continue;
            }


            const box =
                await element.boundingBox();


            if (!box) {
                continue;
            }


            const viewport =
                page.viewportSize();


            /*
             * Right-hand test details panel.
             */

            if (
                viewport &&
                box.x < viewport.width * 0.48
            ) {

                continue;
            }


            console.log(
                `Found test-detail section: ${sectionName}`
            );


            /*
             * Check whether its parent has an
             * aria-expanded state.
             */

            const parent =
                element.locator("..");


            const ariaExpanded =
                await parent.getAttribute(
                    "aria-expanded"
                )
                    .catch(() => null);


            /*
             * Click if it appears collapsed.
             */

            try {

                if (
                    ariaExpanded === "false" ||
                    ariaExpanded === null
                ) {

                    await element.click({
                        timeout: 3000
                    });

                    await sleep(500);

                }

            } catch {
                // It may already be expanded.
            }
        }
    }
}


/*
============================================================
EXPAND RIGHT PANEL GENERIC COLLAPSED ITEMS
============================================================
*/

async function expandRightPanelCollapsedItems(page) {

    console.log(
        "\nChecking for additional collapsed detail items..."
    );


    const selectors = [

        '[aria-expanded="false"]',

        'button[aria-expanded="false"]',

        '[role="button"][aria-expanded="false"]'

    ];


    const viewport =
        page.viewportSize();


    if (!viewport) {
        return;
    }


    for (const selector of selectors) {

        const elements =
            page.locator(selector);


        const count =
            await elements.count();


        for (let i = 0; i < count; i++) {

            const element =
                elements.nth(i);


            if (!await element.isVisible()) {
                continue;
            }


            const box =
                await element.boundingBox();


            if (!box) {
                continue;
            }


            /*
             * Only interact with right-side controls.
             */

            if (
                box.x <
                viewport.width * 0.48
            ) {

                continue;
            }


            try {

                await element.click({
                    timeout: 2000
                });

                await sleep(300);

            } catch {
                // Ignore controls that cannot be clicked.
            }
        }
    }
}


/*
============================================================
PREPARE ALLURE FOR PRINTING
============================================================
*/

async function prepareForPDF(page) {

    await page.addStyleTag({

        content: `

            @media print {

                * {
                    -webkit-print-color-adjust: exact !important;
                    print-color-adjust: exact !important;
                }

                html,
                body {
                    width: 100% !important;
                    height: auto !important;
                }

                /*
                 * Don't clip content during printing.
                 */

                .node_children {
                    overflow: visible !important;
                }

                /*
                 * Allow expanded Allure tree nodes
                 * to remain visible.
                 */

                .node {
                    max-height: none !important;
                }

            }

        `

    });

}


/*
============================================================
CREATE PDF
============================================================
*/

async function createPDF(
    page,
    fileName,
    outputDir,
    landscape = true
) {

    await prepareForPDF(page);


    const pdfPath =
        path.join(
            outputDir,
            fileName
        );


    console.log(
        `Creating PDF: ${fileName}`
    );


    await page.pdf({

        path: pdfPath,

        format: "A4",

        landscape: landscape,

        printBackground: true,

        preferCSSPageSize: false,

        margin: {

            top: "8mm",

            right: "8mm",

            bottom: "8mm",

            left: "8mm"

        }

    });


    console.log(
        `PDF created: ${pdfPath}`
    );


    return pdfPath;
}


/*
============================================================
EXPORT NORMAL SECTION
============================================================
*/

async function exportNormalSection(
    page,
    name,
    hash,
    index,
    outputDir
) {

    console.log(
        `\n==========================================`
    );

    console.log(
        `EXPORTING ${name.toUpperCase()}`
    );

    console.log(
        `==========================================`
    );


    await openSection(
        page,
        hash
    );


    await sleep(1000);


    return await createPDF(
        page,
        `${String(index).padStart(2, "0")}_${name}.pdf`,
        outputDir
    );
}


/*
============================================================
EXPORT INTERACTIVE TREE SECTION
============================================================
*/

async function exportTreeSection(
    page,
    name,
    hash,
    index,
    outputDir
) {

    console.log(
        `\n==========================================`
    );

    console.log(
        `EXPORTING ${name.toUpperCase()}`
    );

    console.log(
        `==========================================`
    );


    /*
     * Open section.
     */

    await openSection(
        page,
        hash
    );


    /*
     * Expand first branch until a test case
     * becomes available.
     */

    const testLink =
        await expandUntilTestCase(page);


    /*
     * If no test was found, still create a PDF
     * showing the current state.
     */

    if (!testLink) {

        console.log(
            `WARNING: No test case found in ${name}`
        );


        return await createPDF(
            page,
            `${String(index).padStart(2, "0")}_${name}_NO_TEST_FOUND.pdf`,
            outputDir
        );
    }


    /*
     * Click first test case.
     */

    await clickTestCase(
        page,
        testLink
    );


    /*
     * Expand Set up / Test body / Tear down.
     */

    await expandTestDetails(
        page
    );


    /*
     * Expand any other collapsed controls
     * in the right-side test panel.
     */

    await expandRightPanelCollapsedItems(
        page
    );


    await sleep(1000);


    /*
     * Put page at the top before printing.
     */

    await page.evaluate(() => {

        window.scrollTo(0, 0);

    });


    await sleep(500);


    /*
     * Capture the state.
     */

    return await createPDF(
        page,
        `${String(index).padStart(2, "0")}_${name}.pdf`,
        outputDir
    );
}


/*
============================================================
MERGE PDFs
============================================================
*/

async function mergePDFs(
    pdfFiles,
    finalPdfPath
) {

    console.log(
        "\n=========================================="
    );

    console.log(
        "MERGING ALL PDFs"
    );

    console.log(
        "=========================================="
    );


    const finalPdf =
        await PDFDocument.create();


    for (const pdfFile of pdfFiles) {

        if (
            !pdfFile ||
            !fs.existsSync(pdfFile)
        ) {

            continue;
        }


        console.log(
            `Adding: ${path.basename(pdfFile)}`
        );


        const bytes =
            fs.readFileSync(
                pdfFile
            );


        const sourcePdf =
            await PDFDocument.load(
                bytes
            );


        const pages =
            await finalPdf.copyPages(
                sourcePdf,
                sourcePdf.getPageIndices()
            );


        pages.forEach(
            page => {

                finalPdf.addPage(
                    page
                );

            }
        );
    }


    const finalBytes =
        await finalPdf.save();


    fs.writeFileSync(
        finalPdfPath,
        finalBytes
    );


    console.log(
        `\nFINAL PDF CREATED:`
    );

    console.log(
        finalPdfPath
    );


    return finalPdfPath;
}


/*
============================================================
MAIN
============================================================
*/

async function generateReport(options = {}) {

    const allureUrl =
        options.url;

    if (!allureUrl) {
        throw new Error("An Allure report URL is required.");
    }

    const outputDir =
        options.outputDir || DEFAULT_OUTPUT_DIR;

    const finalPdfPath =
        options.finalPdfPath || DEFAULT_FINAL_PDF;

    /*
     * Create output directory.
     */

    fs.mkdirSync(
        outputDir,
        {
            recursive: true
        }
    );


    /*
     * Start Chromium.
     */

    console.log(
        "Starting Chromium..."
    );


    const browser =
        await playwrightChromium.launch({
            args: chromium.args,
            defaultViewport: chromium.defaultViewport,
            executablePath: await chromium.executablePath(),
            headless: chromium.headless
        });


    const context =
        await browser.newContext({

            viewport: {

                width: 1500,

                height: 900

            },

            deviceScaleFactor: 1

        });


    const page =
        await context.newPage();


    /*
     * Open Allure.
     */

    console.log(
        "Opening Allure report..."
    );


    await page.goto(
        allureUrl,
        {
            waitUntil: "domcontentloaded"
        }
    );


    await waitForAllure(
        page,
        2000
    );


    const pdfFiles = [];


    /*
     ========================================================
     1. OVERVIEW
     ========================================================
     */

    pdfFiles.push(

        await exportNormalSection(
            page,
            "Overview",
            "#/",
            1,
            outputDir
        )

    );


    /*
     ========================================================
     2. CATEGORIES
     ========================================================
     */

    pdfFiles.push(

        await exportTreeSection(
            page,
            "Categories",
            "#/categories",
            2,
            outputDir
        )

    );


    /*
     ========================================================
     3. SUITES
     ========================================================
     */

    pdfFiles.push(

        await exportTreeSection(
            page,
            "Suites",
            "#/suites",
            3,
            outputDir
        )

    );


    /*
     ========================================================
     4. GRAPHS
     ========================================================
     */

    pdfFiles.push(

        await exportNormalSection(
            page,
            "Graphs",
            "#/graph",
            4,
            outputDir
        )

    );


    /*
     ========================================================
     5. TIMELINE
     ========================================================
     */

    pdfFiles.push(

        await exportNormalSection(
            page,
            "Timeline",
            "#/timeline",
            5,
            outputDir
        )

    );


    /*
     ========================================================
     6. BEHAVIORS
     ========================================================
     */

    pdfFiles.push(

        await exportTreeSection(
            page,
            "Behaviors",
            "#/behaviors",
            6,
            outputDir
        )

    );


    /*
     ========================================================
     7. PACKAGES
     ========================================================
     */

    pdfFiles.push(

        await exportTreeSection(
            page,
            "Packages",
            "#/packages",
            7,
            outputDir
        )

    );


    /*
     ========================================================
     MERGE
     ========================================================
     */

    await mergePDFs(
        pdfFiles,
        finalPdfPath
    );

    fs.rmSync(
        outputDir,
        {
            recursive: true,
            force: true
        }
    );

    console.log(
        `Temporary section PDFs removed: ${outputDir}`
    );


    /*
     * Close browser.
     */

    await browser.close();


    console.log(
        "\n=========================================="
    );

    console.log(
        "ALLURE EXPORT FINISHED SUCCESSFULLY"
    );

    console.log(
        "=========================================="
    );

    console.log(
        `PDF: ${finalPdfPath}`
    );

    console.log(
        `Individual PDFs: ${outputDir}`
    );

    return {
        pdfPath: finalPdfPath
    };
}


/*
============================================================
ERROR HANDLING
============================================================
*/

if (require.main === module) {
    generateReport().catch(error => {

    console.error(
        "\n=========================================="
    );

    console.error(
        "ALLURE EXPORT FAILED"
    );

    console.error(
        "=========================================="
    );

    console.error(
        error
    );

    process.exit(1);

    });
}

module.exports = {
    generateReport
};