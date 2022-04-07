// https://kam.mff.cuni.cz/~elias/glpk.pdf 

// var is not block-scoped
// let is block-scoped
// both var and let can be redefined
// const can't be redefined

import GLPK from './glpk.js';

let maxd_lastmonth;
let maxd_nextmonth;
let tag_lastmonth = "last";
let tag_nextmonth = "next";


function autopopulate () {
    // fill in table-pool based on table-lastmonth
    let tpool = [];

    // fill tpool with whatever's already in the pool
    // TODO

    $("#table-lastmonth").find("input[type=text").each(function (i) {
        let name = $(this).val();
        
        if (name.length != 0 && !tpool.includes(name)) {
            let row = $("<tr>");
            row.append($("<td>").append(
                $("<input>").attr({"type": "text", "class": "name-field", 
                    "value": name, "placeholder": "Name"})
            ));
            row.append($("<td>").append(
                $("<input>").attr({"type": "text", "class": "exemption-field", 
                    "value": "", "placeholder": "Exemptions"})
            ));
            row.append($("<td>").html("<i class='fa-solid fa-xmark' />").click(function () {
                $(this).closest("tr").remove();
            }));

            $("#table-pool tr:last").before(row);
            tpool.push(name);
        }
    });
}

function calculate () {
    // clear previous output (if any)
    $("#table-nextmonth").find("input[type=text]").each(function (i) {
        $(this).val("");
    });

    // build pool and exceptions based on table-pool
    let pool = [];
    let exemptions = [];
    $("#table-pool").find("tr").each(function (i) {
        let name = $(this).find("input[type=text][class='name-field']").val();
        let exps = $(this).find("input[type=text][class='exemption-field").val();

        if (name.length != 0) {
            pool.push(name);

            // this regex deletes whitespace in the entire string before split
            exps = exps.replace(/\s/g, "").split(",");
            exemptions.push(exps);
        }
    });

    // set variables based on data
    let N = pool.length;
    let M = maxd_nextmonth;
    let K = parseInt($("#input-window").val());

    // pull last month
    let pdata = [];
    let Mp = $("#table-lastmonth").find("tr").length;
    // initialize to zero
    for (let i=0; i < N; i++) {
        pdata[i] = [];
        for (let j=0; j < Mp; j++) {
            pdata[i][j] = 0;
        }
    }
    // if name is in pool, insert a # in appropriate column
    $("#table-lastmonth").find("tr").each(function (i) {
        let tds = $(this).find("td");
        let d = parseInt(tds.eq(0).text()),
            n = $(this).find("input[type=text]").val(),
            e = $(this).find("input[type=checkbox]:checked").val();
        e = (e == undefined) ? 1 : 2;
        let ix = pool.indexOf(n);

        if (ix >= 0) {
            pdata[ix][d-1] = e;
        }
    })

    // weighting scheme
    let w = []
    for (let j=0; j < M; j++) {
        w[j] = 1;
    }
    let wkends = $("input[type=checkbox][name='" + tag_nextmonth + "']:checked");
    wkends.each(function (i) {
        let d = parseInt($(this).val());
        w[d] = 2;
    });

    
    // async glpk 
    (async () => {

        const glpk = await GLPK();

        // SHOW RESULTS (callback)
        function print(res) {
            // iterate through all binary variables
            for (let [k,v] of Object.entries(res['result']['vars'])) {
                if (v == 1) {
                    let ix = k.split("-");
                    $("#next" + ix[2]).val(pool[parseInt(ix[1])]);
                }
            }
        };

        
        // SETUP LP

        // problem setup (doesn't change)
        // min smax - smin
        const lp = {
            name: 'LP',
            objective: {
                direction: glpk.GLP_MIN,
                name: 'obj',
                vars: [
                    {name: 'smax', coef: 1},
                    {name: 'smin', coef: -1}
                ]
            },
            subjectTo: [],
            binaries: [],
            generals: ['smax', 'smin'],
            options: { msglev: glpk.GLP_MSG_ALL }
        };

        // running index for constraints
        let u = 0;

        // enforce all exemptions
        for (let i=0; i < N; i++) {
            if (exemptions[i][0] == "") {
                continue;
            }

            for (let e of exemptions[i]) {
                let en = parseInt(e);
                lp["subjectTo"][u] = {
                    name: "ce" + i + en,
                    vars: [{name: "x-" + i + "-" + (en-1), coef: 1}],
                    bnds: {type: glpk.GLP_FX, lb: 0}
                };

                u++;
            } 
        }

        // equality constraints (cc): enforce 1 employee per day
        // \sum_i x_ij = 1 \forall j
        for (let j=0; j < M; j++) {
            lp['subjectTo'][u] = {
                name: 'cc' + j,
                vars: [],
                bnds: {type: glpk.GLP_FX, lb: 1}
            };

            for (let i=0; i < N; i++) {
                lp['subjectTo'][u]['vars'][i] = {
                    name: "x" + "-" + i + "-" + j, coef: 1
                };
            }

            u++;
        }

        // max / min constraints (cx / cn)
        // double work is hacky, was having issues with pop tho
        // incorporate weighting scheme as coef
        for (let i=0; i < N; i++) {
            let vx = [];
            let vn = [];
            for (let j=0; j < M; j++) {
                vx[j] = {name: "x" + "-" + i + "-" + j, coef: w[j]};
                vn[j] = {name: "x" + "-" + i + "-" + j, coef: w[j]};
            }

            // incorporate last month
            let pij = 0;
            for (let j=0; j < Mp; j++) {
                pij += pdata[i][j];
            }

            // max
            // \sum_j P_ij + \sum_j x_ij * w_j <= s_max \forall i
            vx.push({name: 'smax', coef: -1});
            lp['subjectTo'][u] = {
                name: 'cx' + i,
                vars: vx,
                bnds: {type: glpk.GLP_UP, ub: -pij}
            }

            u++;

            // min
            // \sum_j P_ij + \sum_j x_ij * w_j >= smin \forall i
            vn.push({name: 'smin', coef: -1});
            lp['subjectTo'][u] = {
                name: 'cn' + i,
                vars: vn,
                bnds: {type: glpk.GLP_LO, lb: -pij}
            }   

            u++;     
        }

        // add max 1 shift in K window constraints
        for (let i=0; i < N; i++) {
            // current month
            for (let j=0; j < (M - K + 1); j++) {
                let vs = [];
                for (let k=0; k < K; k++) {
                    vs[k] = {name: "x-" + i + "-" + (j+k), coef: 1};
                }
                lp["subjectTo"][u] = {
                    name: "cs" + i + "-" + j,
                    vars: vs,
                    bnds: {type: glpk.GLP_UP, ub: 1}
                };
                u++;
            }

            // previous month
            for (let h=1; h < K; h++) {
                let temp = 0;
                for (let j=Mp-K+h; j < Mp; j++) {
                    temp += pdata[i][j];
                }
                let vs = [];
                for (let j=0; j < h; j++) {
                    vs[j] = {name: "x-" + i + "-" + j, coef: 1};
                }
                lp["subjectTo"][u] = {
                    name: "cso" + i + "-" + h,
                    vars: vs,
                    bnds: {type: glpk.GLP_UP, ub: 1-temp}
                };
                u++;
            }
        }

        // reset running index, add list all binary variables
        u = 0
        for (let i=0; i < N; i++) {
            for (let j=0; j < M; j++) {
                lp['binaries'][u] = "x" + "-" + i + "-" + j;
                u++;
            }
        }

        glpk.solve(lp, {})
            .then(res => print(res))
            .catch(err => console.log(err));

    })();
}

// Quick and simple export target #table_id into a csv
// https://stackoverflow.com/questions/15547198/export-html-table-to-csv-using-vanilla-javascript
function download_table_as_csv(table_id, separator=',') {
    // Construct csv
    let csv = [];
    csv.push(["Date", "Day", "Weekend", "Name"]);
    $("#" + table_id).find("tr").each(function () {
        let tds = $(this).find("td");
        let d = tds.eq(0).text(),
            t = tds.eq(1).text();
        let n = $(this).find("input[type=text]").val();
        let wkend = $(this).find("input[type=checkbox]:checked").val();
        wkend = (wkend == undefined) ? "N" : "Y"

        csv.push([d, t, wkend, n].join(separator));
    });
    let csv_string = csv.join("\n");

    // Download it
    var filename = 'export_' + table_id + '_' + new Date().toLocaleDateString() + '.csv';
    var link = document.createElement('a');
    link.style.display = 'none';
    link.setAttribute('target', '_blank');
    link.setAttribute('href', 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv_string));
    link.setAttribute('download', filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

function fillMonth (p, tag, subtag) {
    // p=-1 => last month
    // p=0 => current month

    let days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    let today = new Date();

    let maxd = new Date(today.getFullYear(), today.getMonth() + (p+1), 0).getDate();
    for (let i=0; i < maxd; i++) {
        let row = $("<tr>");
        let day = days[ new Date(today.getFullYear(), today.getMonth() + p, i+1).getDay() ];
        
        row.append($("<td>").text(i+1));
        row.append($("<td>").text(day));

        if (day == "Sun" || day == "Fri" || day == "Sat") {
            row.append($("<td>").append(
                $("<input>").attr({"type": "checkbox", "name": subtag, "value": i, "checked": "True"})
            ));        
        } else {
            row.append($("<td>").append(
                $("<input>").attr({"type": "checkbox", "name": subtag, "value": i})
            ));
        }
        
        row.append($("<td>").append(
            $("<input>").attr({"type": "text", "class": "name-field", "id": subtag + i, "placeholder": "Name"})
        ));

        $(tag).append(row);
    }

    return maxd;
}

function addPoolRow () {
    let row = $("<tr>");
    row.append($("<td>").append(
        $("<input>").attr({"type": "text", "class": "name-field", 
            "placeholder": "Name"})    
    ));
    row.append($("<td>").append(
        $("<input>").attr({"type": "text", "class": "exemption-field", 
            "placeholder": "Exemptions"})
    ));
    row.append($("<td>").html("<i class='fa-solid fa-xmark' />").click(function () {
        $(this).closest("tr").remove();
    }));
    $("#table-pool").append(row);  
}


$(document).ready(function () {

    // PREFILL MONTHS
    // fill lastmonth and nextmonth with dates based on current month

    // TODO handle edge exceptions (Jan/Dec)
    maxd_lastmonth = fillMonth(-1, "#table-lastmonth", tag_lastmonth);
    maxd_nextmonth = fillMonth(0,  "#table-nextmonth", tag_nextmonth);

    // start POOL with single input line
    addPoolRow();
    

    // BUTTON HANDLING

    // load demo names
    $("#btn-demo").click(function () {
        let demo = [
            "Smith", "King", "McDonald", "Marino", "Parnell",
            "Renner", "Heddy", "Tolle", "Argyle", "Hart", "Moore", "Marino",
            "Smith", "McDonald", "Cranston", "Sulewski", "Keen", "Windham", "King",
            "Renner", "Heddy", "Tolle", "Argyle", "Hart", "Moore", "Marino",
            "Smith", "McDonald", "Cranston", "Sulewski", "Gonzalez" 
        ];

        $("#table-lastmonth").find("input[type=text]").each(function (i) {
            $(this).val(demo[i]);
        });
    });

    // clear names
    $("#btn-clear-lastmonth").click(function () {
       $("#table-lastmonth").find("input[type=text]").each(function (i) {
            $(this).val("");
        }); 
    });

    $("#btn-clear-pool").click(function () {
       $("#table-pool").find("input[type=text]").each(function (i) {
            $(this).val("");
        }); 
    });

    // button to autopopulate names from lastmonth into pool
    $("#btn-autopopulate").click(function () {
        autopopulate();
    });

    // add row
    $("#btn-add-row").click(function () {
        addPoolRow();
    })

    // calculate optimal roster
    $("#btn-calculate").click(function () {
        calculate();
    });

    // export as csv button
    $("#btn-export").click(function () {
        download_table_as_csv("table-lastmonth");
    })
});